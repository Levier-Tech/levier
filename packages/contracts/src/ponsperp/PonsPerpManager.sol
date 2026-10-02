// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IPonsFactory} from "./IPonsFactory.sol";
import {PonsV4TwapOracle} from "./PonsV4TwapOracle.sol";
import {PonsLiquidityVault} from "./PonsLiquidityVault.sol";

/// @title PonsPerpManager
/// @notice Small, capped leverage on graduated Pons tokens, settled in USDG against `PonsLiquidityVault`.
/// @dev Positions are synthetic: no token is bought. PnL = size * (exit - entry) / entry, with profit
/// capped at `size`, which the vault reserves when the position opens, so every payout is funded.
/// Entries and exits use the worse of spot and TWAP for the trader; liquidations use the TWAP only.
/// @dev Deployed behind an ERC1967 UUPS proxy. Opening starts paused; closing is never paused.
contract PonsPerpManager is Initializable, OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    struct Market {
        bool listed;
        uint16 maxLeverageBps; // 20_000 = 2x
        uint16 maintenanceMarginBps;
        uint128 maxPositionSize; // USDG units, notional
        uint128 maxOpenInterest; // USDG units, long + short notional
        uint128 openInterest;
    }

    struct Position {
        address trader;
        address asset;
        bool isLong;
        uint64 openedAt;
        uint128 collateral; // USDG units, after the opening fee
        uint128 size; // USDG units, notional
        uint256 entryPrice; // USD 1e18 per whole token
    }

    uint256 public constant BPS = 10_000;
    uint16 public constant HARD_MAX_LEVERAGE_BPS = 50_000; // 5x ceiling no config can exceed
    uint8 private constant GRADUATED = 2;

    error InvalidConfiguration();
    error OpeningPaused();
    error MarketNotListed();
    error NotGraduated();
    error InvalidLeverage();
    error PositionTooLarge();
    error OpenInterestCap();
    error UtilizationCap();
    error NotTrader();
    error UnknownPosition();
    error MinHoldTime();
    error NotLiquidatable();

    event MarketSet(
        address indexed asset, uint16 maxLeverageBps, uint16 maintenanceMarginBps, uint128 maxPositionSize, uint128 maxOpenInterest
    );
    event ParamsUpdated(uint16 feeBps, uint16 liquidationRewardBps, uint128 minLiquidationReward, uint32 minHoldTime, uint16 maxUtilizationBps);
    event OpeningPauseUpdated(bool paused);
    event PositionOpened(
        uint256 indexed id, address indexed trader, address indexed asset, bool isLong, uint256 collateral, uint256 size, uint256 entryPrice, uint256 fee
    );
    event PositionClosed(uint256 indexed id, address indexed trader, uint256 exitPrice, int256 pnl, uint256 fee, uint256 payout);
    event PositionLiquidated(uint256 indexed id, address indexed liquidator, uint256 price, uint256 reward, uint256 traderPayout);

    IERC20 public usdg;
    PonsV4TwapOracle public oracle;
    PonsLiquidityVault public vault;
    IPonsFactory public ponsFactory;

    bool public openingPaused;
    uint16 public feeBps;
    uint16 public liquidationRewardBps;
    uint128 public minLiquidationReward;
    uint32 public minHoldTime;
    uint16 public maxUtilizationBps;

    uint256 public nextPositionId;
    mapping(address => Market) public markets;
    mapping(uint256 => Position) public positions;
    mapping(address => uint256[]) private traderPositions;
    mapping(uint256 => uint256) private traderIndex;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @dev Only the owner can move this proxy to a new implementation.
    function _authorizeUpgrade(address) internal override onlyOwner {}

    function initialize(address initialOwner, address usdg_, address oracle_, address vault_, address ponsFactory_)
        external
        initializer
    {
        if (
            usdg_.code.length == 0 || oracle_.code.length == 0 || vault_.code.length == 0 || ponsFactory_.code.length == 0
                || PonsLiquidityVault(vault_).asset() != usdg_
        ) revert InvalidConfiguration();
        __Ownable_init(initialOwner);
        usdg = IERC20(usdg_);
        oracle = PonsV4TwapOracle(oracle_);
        vault = PonsLiquidityVault(vault_);
        ponsFactory = IPonsFactory(ponsFactory_);
        openingPaused = true;
        nextPositionId = 1;
        _setParams(30, 500, 100_000, 5 minutes, 5_000); // 0.3% fee, 5% reward, min $0.10, 5 min hold, 50% utilization
    }

    // ─── Admin ──────────────────────────────────────────────────────────

    function setMarket(
        address asset,
        uint16 maxLeverageBps,
        uint16 maintenanceMarginBps,
        uint128 maxPositionSize,
        uint128 maxOpenInterest
    ) external onlyOwner {
        if (
            asset == address(0) || maxLeverageBps < BPS || maxLeverageBps > HARD_MAX_LEVERAGE_BPS
                || maintenanceMarginBps == 0 || maintenanceMarginBps >= BPS * BPS / maxLeverageBps
                || maxPositionSize == 0 || maxOpenInterest < maxPositionSize
        ) revert InvalidConfiguration();
        Market storage m = markets[asset];
        m.listed = true;
        m.maxLeverageBps = maxLeverageBps;
        m.maintenanceMarginBps = maintenanceMarginBps;
        m.maxPositionSize = maxPositionSize;
        m.maxOpenInterest = maxOpenInterest;
        emit MarketSet(asset, maxLeverageBps, maintenanceMarginBps, maxPositionSize, maxOpenInterest);
    }

    function setParams(
        uint16 feeBps_,
        uint16 liquidationRewardBps_,
        uint128 minLiquidationReward_,
        uint32 minHoldTime_,
        uint16 maxUtilizationBps_
    ) external onlyOwner {
        _setParams(feeBps_, liquidationRewardBps_, minLiquidationReward_, minHoldTime_, maxUtilizationBps_);
    }

    function _setParams(
        uint16 feeBps_,
        uint16 liquidationRewardBps_,
        uint128 minLiquidationReward_,
        uint32 minHoldTime_,
        uint16 maxUtilizationBps_
    ) private {
        if (
            feeBps_ > 100 || liquidationRewardBps_ > 2_000 || minHoldTime_ > 1 hours || maxUtilizationBps_ == 0
                || maxUtilizationBps_ > 8_000
        ) revert InvalidConfiguration();
        feeBps = feeBps_;
        liquidationRewardBps = liquidationRewardBps_;
        minLiquidationReward = minLiquidationReward_;
        minHoldTime = minHoldTime_;
        maxUtilizationBps = maxUtilizationBps_;
        emit ParamsUpdated(feeBps_, liquidationRewardBps_, minLiquidationReward_, minHoldTime_, maxUtilizationBps_);
    }

    function setOpeningPaused(bool paused) external onlyOwner {
        openingPaused = paused;
        emit OpeningPauseUpdated(paused);
    }

    // ─── Trading ────────────────────────────────────────────────────────

    /// @param collateral USDG pulled from the caller; the opening fee is taken from it.
    /// @param leverageBps 10_000 = 1x, up to the market's `maxLeverageBps`.
    function openPosition(address asset, bool isLong, uint256 collateral, uint256 leverageBps)
        external
        nonReentrant
        returns (uint256 id)
    {
        if (openingPaused) revert OpeningPaused();
        Market storage m = markets[asset];
        if (!m.listed) revert MarketNotListed();
        IPonsFactory.LaunchedToken memory launch = ponsFactory.getLaunchedToken(asset);
        if (!launch.exists || launch.phase != GRADUATED) revert NotGraduated();
        if (leverageBps < BPS || leverageBps > m.maxLeverageBps) revert InvalidLeverage();

        uint256 fee = collateral * leverageBps / BPS * feeBps / BPS;
        uint256 net = collateral - fee;
        uint256 size = net * leverageBps / BPS;
        if (size == 0 || size > m.maxPositionSize) revert PositionTooLarge();
        if (m.openInterest + size > m.maxOpenInterest) revert OpenInterestCap();

        usdg.safeTransferFrom(msg.sender, address(this), collateral);
        if (fee > 0) usdg.safeTransfer(address(vault), fee);
        if (vault.reserved() + size > vault.totalAssets() * maxUtilizationBps / BPS) revert UtilizationCap();
        vault.reserve(size);

        (uint256 spot, uint256 twap) = oracle.update(asset);
        uint256 entry = isLong ? _max(spot, twap) : _min(spot, twap);

        id = nextPositionId++;
        positions[id] = Position(msg.sender, asset, isLong, uint64(block.timestamp), uint128(net), uint128(size), entry);
        m.openInterest += uint128(size);
        traderIndex[id] = traderPositions[msg.sender].length;
        traderPositions[msg.sender].push(id);
        emit PositionOpened(id, msg.sender, asset, isLong, net, size, entry, fee);
    }

    function closePosition(uint256 id) external nonReentrant {
        Position memory p = positions[id];
        if (p.trader == address(0)) revert UnknownPosition();
        if (p.trader != msg.sender) revert NotTrader();
        if (block.timestamp < p.openedAt + minHoldTime) revert MinHoldTime();

        (uint256 spot, uint256 twap) = oracle.update(p.asset);
        uint256 exitPrice = p.isLong ? _min(spot, twap) : _max(spot, twap);
        int256 pnl = _pnl(p, exitPrice);
        uint256 fee = uint256(p.size) * feeBps / BPS;
        int256 equity = int256(uint256(p.collateral)) + pnl - int256(fee);
        uint256 payout = equity > 0 ? uint256(equity) : 0;

        _remove(id, p);
        _settle(p, payout, msg.sender);
        emit PositionClosed(id, p.trader, exitPrice, pnl, fee, payout);
    }

    /// @notice Anyone may liquidate a position whose TWAP-valued equity is below maintenance margin.
    /// The liquidator is paid from the position's collateral.
    function liquidatePosition(uint256 id) external nonReentrant {
        Position memory p = positions[id];
        if (p.trader == address(0)) revert UnknownPosition();
        (, uint256 twap) = oracle.update(p.asset);
        int256 equity = int256(uint256(p.collateral)) + _pnl(p, twap);
        uint256 maintenance = uint256(p.size) * markets[p.asset].maintenanceMarginBps / BPS;
        if (equity >= int256(maintenance)) revert NotLiquidatable();

        uint256 reward = uint256(p.collateral) * liquidationRewardBps / BPS;
        if (reward < minLiquidationReward) reward = minLiquidationReward;
        if (reward > p.collateral) reward = p.collateral;
        uint256 remaining = equity > int256(reward) ? uint256(equity) - reward : 0;

        _remove(id, p);
        // Collateral covers reward + remaining, since equity < maintenance < collateral.
        usdg.safeTransfer(msg.sender, reward);
        if (remaining > 0) usdg.safeTransfer(p.trader, remaining);
        uint256 toVault = uint256(p.collateral) - reward - remaining;
        if (toVault > 0) usdg.safeTransfer(address(vault), toVault);
        vault.release(p.size);
        emit PositionLiquidated(id, msg.sender, twap, reward, remaining);
    }

    // ─── Views ──────────────────────────────────────────────────────────

    function positionsOf(address trader) external view returns (uint256[] memory) {
        return traderPositions[trader];
    }

    /// @notice Unrealized PnL and liquidation status at current oracle prices (no state change).
    function previewPosition(uint256 id) external view returns (int256 pnl, int256 equity, bool liquidatable) {
        Position memory p = positions[id];
        if (p.trader == address(0)) revert UnknownPosition();
        (uint256 spot, uint256 twap) = oracle.peek(p.asset);
        pnl = _pnl(p, p.isLong ? _min(spot, twap) : _max(spot, twap));
        equity = int256(uint256(p.collateral)) + pnl - int256(uint256(p.size) * feeBps / BPS);
        int256 twapEquity = int256(uint256(p.collateral)) + _pnl(p, twap);
        liquidatable = twapEquity < int256(uint256(p.size) * markets[p.asset].maintenanceMarginBps / BPS);
    }

    // ─── Internal ───────────────────────────────────────────────────────

    /// @dev Profit is capped at `size` (the reserved amount); loss is uncapped here and bounded by settlement.
    function _pnl(Position memory p, uint256 price) private pure returns (int256) {
        int256 move = p.isLong ? int256(price) - int256(p.entryPrice) : int256(p.entryPrice) - int256(price);
        int256 pnl = int256(uint256(p.size)) * move / int256(p.entryPrice);
        return pnl > int256(uint256(p.size)) ? int256(uint256(p.size)) : pnl;
    }

    function _settle(Position memory p, uint256 payout, address to) private {
        if (payout > p.collateral) {
            usdg.safeTransfer(to, p.collateral);
            vault.release(p.size);
            vault.pay(to, payout - p.collateral);
        } else {
            if (payout > 0) usdg.safeTransfer(to, payout);
            if (p.collateral > payout) usdg.safeTransfer(address(vault), p.collateral - payout);
            vault.release(p.size);
        }
    }

    function _remove(uint256 id, Position memory p) private {
        markets[p.asset].openInterest -= p.size;
        uint256[] storage list = traderPositions[p.trader];
        uint256 index = traderIndex[id];
        uint256 lastId = list[list.length - 1];
        list[index] = lastId;
        traderIndex[lastId] = index;
        list.pop();
        delete traderIndex[id];
        delete positions[id];
    }

    function _max(uint256 a, uint256 b) private pure returns (uint256) {
        return a > b ? a : b;
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}
