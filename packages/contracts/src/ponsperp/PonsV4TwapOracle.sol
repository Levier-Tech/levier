// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IPonsFactory, IPoolManagerExtsload, IUsdPriceOracle} from "./IPonsFactory.sol";

/// @title PonsV4TwapOracle
/// @notice USD price for a graduated Pons token, read from its canonical Uniswap v4 ETH pool and
/// converted with the Chainlink ETH/USD feed. There is no manual price setter.
/// @dev The TWAP is "lazy": observations are written whenever anyone calls `update`, which the
/// position manager does on every open, close and liquidation. Each update may move the recorded
/// price by at most `maxMoveBps`, so one manipulated block cannot drag the average far.
/// Only the pool keyed by the Pons hook is read; look-alike pools created by third parties are ignored.
/// @dev Deployed behind an ERC1967 UUPS proxy.
contract PonsV4TwapOracle is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    struct Observation {
        uint64 timestamp;
        uint256 cumulative; // sum of ethPerToken1e18 * seconds
    }

    struct AssetState {
        bytes32 poolId;
        uint256 lastPrice; // ETH per whole token, 1e18, clamped
        uint64 lastTimestamp;
        uint256 cumulative;
        uint8 next; // ring buffer write index
        uint8 count;
    }

    uint8 public constant BUFFER = 16;
    /// @dev Uniswap v4 `PoolManager._pools` storage slot.
    bytes32 private constant POOLS_SLOT = bytes32(uint256(6));
    uint256 private constant Q96 = 2 ** 96;

    error InvalidConfiguration();
    error UnknownAsset();
    error PoolNotInitialized();
    error TwapNotReady();
    error PriceDeviation(uint256 spot, uint256 twap);

    event AssetListed(address indexed asset, bytes32 indexed poolId);
    event Updated(address indexed asset, uint256 spotEth, uint256 recordedEth);
    event ParamsUpdated(uint32 window, uint32 minSpacing, uint16 maxMoveBps, uint16 maxDeviationBps);

    IPoolManagerExtsload public poolManager;
    IPonsFactory public ponsFactory;
    address public hook;
    IUsdPriceOracle public ethUsdOracle;
    address public ethUsdAsset; // key used in `ethUsdOracle` (WETH)

    uint32 public window; // seconds
    uint32 public minSpacing; // seconds between stored observations
    uint16 public maxMoveBps; // max recorded-price move per update
    uint16 public maxDeviationBps; // max |spot - twap| / twap accepted by `update`

    mapping(address => AssetState) public assets;
    mapping(address => Observation[16]) private observations;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @dev Only the owner can move this proxy to a new implementation.
    function _authorizeUpgrade(address) internal override onlyOwner {}

    function initialize(
        address initialOwner,
        address poolManager_,
        address ponsFactory_,
        address hook_,
        address ethUsdOracle_,
        address ethUsdAsset_
    ) external initializer {
        if (
            poolManager_.code.length == 0 || ponsFactory_.code.length == 0 || hook_.code.length == 0
                || ethUsdOracle_.code.length == 0 || ethUsdAsset_ == address(0)
        ) revert InvalidConfiguration();
        __Ownable_init(initialOwner);
        poolManager = IPoolManagerExtsload(poolManager_);
        ponsFactory = IPonsFactory(ponsFactory_);
        hook = hook_;
        ethUsdOracle = IUsdPriceOracle(ethUsdOracle_);
        ethUsdAsset = ethUsdAsset_;
        _setParams(30 minutes, 4 minutes, 1_000, 1_500);
    }

    function setParams(uint32 window_, uint32 minSpacing_, uint16 maxMoveBps_, uint16 maxDeviationBps_)
        external
        onlyOwner
    {
        _setParams(window_, minSpacing_, maxMoveBps_, maxDeviationBps_);
    }

    function _setParams(uint32 window_, uint32 minSpacing_, uint16 maxMoveBps_, uint16 maxDeviationBps_) private {
        // The ring buffer must always hold an observation at least `window` old.
        if (
            window_ < 5 minutes || window_ > 1 days || minSpacing_ == 0 || uint256(minSpacing_) * (BUFFER - 1) < window_
                || maxMoveBps_ == 0 || maxMoveBps_ > 5_000 || maxDeviationBps_ == 0 || maxDeviationBps_ > 5_000
        ) revert InvalidConfiguration();
        window = window_;
        minSpacing = minSpacing_;
        maxMoveBps = maxMoveBps_;
        maxDeviationBps = maxDeviationBps_;
        emit ParamsUpdated(window_, minSpacing_, maxMoveBps_, maxDeviationBps_);
    }

    /// @notice Lists a Pons token whose launch pairs against native ETH. The pool key comes from the
    /// Pons factory, so it can be listed before graduation; prices are only served once the pool exists.
    function listAsset(address asset) external onlyOwner {
        if (assets[asset].poolId != bytes32(0)) revert InvalidConfiguration();
        IPonsFactory.LaunchedToken memory launch = ponsFactory.getLaunchedToken(asset);
        if (!launch.exists || launch.token != asset || launch.pairToken != address(0)) revert InvalidConfiguration();
        // PoolKey {currency0: ETH, currency1: asset, fee, tickSpacing, hooks}
        bytes32 poolId = keccak256(abi.encode(address(0), asset, launch.poolFee, launch.tickSpacing, hook));
        assets[asset].poolId = poolId;
        emit AssetListed(asset, poolId);
    }

    /// @notice Current pool price in ETH per whole token (1e18), unclamped.
    function spotEth(address asset) public view returns (uint256) {
        bytes32 poolId = assets[asset].poolId;
        if (poolId == bytes32(0)) revert UnknownAsset();
        bytes32 slot0 = poolManager.extsload(keccak256(abi.encodePacked(poolId, POOLS_SLOT)));
        uint256 sqrtPriceX96 = uint256(slot0) & type(uint160).max;
        if (sqrtPriceX96 == 0) revert PoolNotInitialized();
        // sqrtPriceX96^2 / 2^192 = token per ETH; invert for ETH per token.
        uint256 priceX96 = Math.mulDiv(sqrtPriceX96, sqrtPriceX96, Q96);
        return Math.mulDiv(1e18, Q96, priceX96);
    }

    /// @notice Records an observation without reading the TWAP. Anyone may call it; it is how the
    /// average is warmed up and kept fresh between trades.
    function poke(address asset) public {
        uint256 spot = spotEth(asset);
        AssetState storage s = assets[asset];
        uint64 nowTs = uint64(block.timestamp);

        if (s.count == 0) {
            s.lastPrice = spot;
            s.lastTimestamp = nowTs;
            _write(asset, s, nowTs);
        } else if (nowTs > s.lastTimestamp) {
            s.cumulative += s.lastPrice * (nowTs - s.lastTimestamp);
            s.lastTimestamp = nowTs;
            s.lastPrice = _clamp(spot, s.lastPrice);
            Observation memory newest = observations[asset][(s.next + BUFFER - 1) % BUFFER];
            if (nowTs - newest.timestamp >= minSpacing) _write(asset, s, nowTs);
        }
        emit Updated(asset, spot, s.lastPrice);
    }

    /// @notice Records an observation and returns USD prices (1e18 per whole token).
    /// Reverts while the TWAP is not ready or when spot and TWAP diverge by more than `maxDeviationBps`.
    /// @return spotUsd current pool price
    /// @return twapUsd time-weighted average over at least `window`
    function update(address asset) external returns (uint256 spotUsd, uint256 twapUsd) {
        poke(asset);
        return peek(asset);
    }

    /// @notice View of the prices `update` would return, without writing an observation.
    function peek(address asset) public view returns (uint256 spotUsd, uint256 twapUsd) {
        uint256 spot = spotEth(asset);
        uint256 twap = _twapEth(asset);
        _checkDeviation(spot, twap);
        uint256 ethUsd = ethUsdOracle.getPrice(ethUsdAsset);
        return (Math.mulDiv(spot, ethUsd, 1e18), Math.mulDiv(twap, ethUsd, 1e18));
    }

    function _write(address asset, AssetState storage s, uint64 nowTs) private {
        observations[asset][s.next] = Observation(nowTs, s.cumulative);
        s.next = uint8((s.next + 1) % BUFFER);
        if (s.count < BUFFER) s.count++;
    }

    function _clamp(uint256 spot, uint256 last) private view returns (uint256) {
        uint256 hi = last * (10_000 + maxMoveBps) / 10_000;
        uint256 lo = last * (10_000 - maxMoveBps) / 10_000;
        return spot > hi ? hi : spot < lo ? lo : spot;
    }

    function _checkDeviation(uint256 spot, uint256 twap) private view {
        uint256 diff = spot > twap ? spot - twap : twap - spot;
        if (diff * 10_000 > twap * maxDeviationBps) revert PriceDeviation(spot, twap);
    }

    function _twapEth(address asset) private view returns (uint256) {
        AssetState storage s = assets[asset];
        if (s.poolId == bytes32(0)) revert UnknownAsset();
        uint256 nowTs = block.timestamp;
        uint256 cumNow = s.cumulative + s.lastPrice * (nowTs - s.lastTimestamp);
        uint256 target = nowTs - window;
        // Newest observation that is at least `window` old.
        for (uint256 i = 1; i <= s.count; ++i) {
            Observation memory o = observations[asset][(s.next + BUFFER - i) % BUFFER];
            if (o.timestamp <= target) {
                return (cumNow - o.cumulative) / (nowTs - o.timestamp);
            }
        }
        revert TwapNotReady();
    }
}
