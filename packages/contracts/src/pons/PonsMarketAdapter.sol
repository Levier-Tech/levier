// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./IPonsMarketAdapter.sol";

/**
 * @title PonsMarketAdapter
 * @notice On-chain adapter that detects Pons-graduated assets and evaluates
 *         their eligibility for leverage trading on Levier Markets.
 * @dev    Graduation status can be read from a Pons bonding-curve contract
 *         (when its address is set) or overridden manually by the owner.
 *         Market metadata (liquidity, market cap, volume) is cached on-chain
 *         by authorised updater bots to avoid expensive DEX reads on every call.
 */
contract PonsMarketAdapter is IPonsMarketAdapter, Ownable {

    // ─── State ──────────────────────────────────────────────────────────

    /// @notice Address of the Pons bonding-curve contract (zero = manual-only mode).
    address public ponsBondingCurve;

    /// @notice Minimum DEX liquidity (USD, 18 decimals) required for eligibility.
    uint256 public minLiquidity;

    /// @notice Minimum 24-hour volume (USD, 18 decimals) required for eligibility.
    uint256 public minVolume;

    /// @notice Minimum market cap (USD, 18 decimals) required for eligibility.
    uint256 public minMarketCap;

    /// @notice Owner can explicitly mark an asset as graduated.
    mapping(address => bool) public manualGraduated;

    /// @notice Owner can explicitly mark an asset as eligible (bypasses threshold checks).
    mapping(address => bool) public manualEligible;

    /// @notice Owner can block an asset from eligibility regardless of metrics.
    mapping(address => bool) public manualBlocked;

    /// @notice Addresses authorised to call `updateMetadata`.
    mapping(address => bool) public isUpdater;

    /// @notice Enumerable list of known assets.
    address[] public knownAssets;
    mapping(address => bool) internal _isKnown;

    /// @notice Cached on-chain metadata per asset.
    struct CachedMetadata {
        uint256 liquidity;
        uint256 marketCap;
        uint256 volume;
        uint256 updatedAt;
    }
    mapping(address => CachedMetadata) public metadata;

    // ─── Events ─────────────────────────────────────────────────────────

    event ThresholdsUpdated(uint256 minLiquidity, uint256 minVolume, uint256 minMarketCap);
    event MetadataUpdated(address indexed asset, uint256 liquidity, uint256 marketCap, uint256 volume);
    event ManualGraduatedSet(address indexed asset, bool graduated);
    event ManualEligibilitySet(address indexed asset, bool eligible);
    event ManualBlockSet(address indexed asset, bool blocked);
    event UpdaterSet(address indexed updater, bool status);
    event PonsBondingCurveSet(address indexed bondingCurve);

    // ─── Constructor ────────────────────────────────────────────────────

    constructor(
        address _ponsBondingCurve,
        uint256 _minLiquidity,
        uint256 _minVolume,
        uint256 _minMarketCap,
        address _initialOwner
    ) Ownable(_initialOwner) {
        ponsBondingCurve = _ponsBondingCurve;
        minLiquidity = _minLiquidity;
        minVolume = _minVolume;
        minMarketCap = _minMarketCap;
        emit ThresholdsUpdated(_minLiquidity, _minVolume, _minMarketCap);
        if (_ponsBondingCurve != address(0)) {
            emit PonsBondingCurveSet(_ponsBondingCurve);
        }
    }

    // ─── IPonsMarketAdapter ─────────────────────────────────────────────

    /**
     * @notice Check whether an asset has graduated from Pons.
     * @dev    Tries the bonding-curve contract first; falls back to the manual flag.
     */
    function isGraduated(address asset) public view override returns (bool) {
        if (manualGraduated[asset]) return true;
        if (ponsBondingCurve == address(0)) return false;

        // Static-call `graduated(address)` on the bonding-curve contract.
        // If the call reverts (unknown selector, etc.) we treat it as non-graduated.
        (bool ok, bytes memory data) = ponsBondingCurve.staticcall(
            abi.encodeWithSignature("graduated(address)", asset)
        );
        if (ok && data.length >= 32) {
            return abi.decode(data, (bool));
        }
        return false;
    }

    /**
     * @notice Check whether a graduated asset meets leverage-eligibility criteria.
     */
    function isEligible(address asset) public view override returns (bool) {
        if (manualBlocked[asset]) return false;
        if (!isGraduated(asset)) return false;
        if (manualEligible[asset]) return true;

        CachedMetadata memory m = metadata[asset];
        return m.liquidity >= minLiquidity
            && m.volume >= minVolume
            && m.marketCap >= minMarketCap;
    }

    /**
     * @notice Return cached market metadata for an asset.
     */
    function getMarketMetadata(address asset)
        external
        view
        override
        returns (uint256 liquidity, uint256 marketCap, uint256 volume, bool graduated)
    {
        CachedMetadata memory m = metadata[asset];
        return (m.liquidity, m.marketCap, m.volume, isGraduated(asset));
    }

    // ─── Keeper / Updater ───────────────────────────────────────────────

    modifier onlyUpdater() {
        require(isUpdater[msg.sender] || msg.sender == owner(), "Adapter: Not an updater");
        _;
    }

    /**
     * @notice Refresh cached metadata for an asset.
     * @dev    Called by authorised keeper bots after reading DEX state off-chain.
     */
    function updateMetadata(
        address asset,
        uint256 _liquidity,
        uint256 _marketCap,
        uint256 _volume
    ) external onlyUpdater {
        require(asset != address(0), "Adapter: Zero address");

        if (!_isKnown[asset]) {
            knownAssets.push(asset);
            _isKnown[asset] = true;
        }

        metadata[asset] = CachedMetadata({
            liquidity: _liquidity,
            marketCap: _marketCap,
            volume: _volume,
            updatedAt: block.timestamp
        });

        emit MetadataUpdated(asset, _liquidity, _marketCap, _volume);
    }

    /**
     * @notice Batch-update metadata for multiple assets in one transaction.
     */
    function batchUpdateMetadata(
        address[] calldata assets,
        uint256[] calldata liquidities,
        uint256[] calldata marketCaps,
        uint256[] calldata volumes
    ) external onlyUpdater {
        uint256 len = assets.length;
        require(
            len == liquidities.length && len == marketCaps.length && len == volumes.length,
            "Adapter: Array length mismatch"
        );

        for (uint256 i = 0; i < len; i++) {
            address asset = assets[i];
            require(asset != address(0), "Adapter: Zero address");

            if (!_isKnown[asset]) {
                knownAssets.push(asset);
                _isKnown[asset] = true;
            }

            metadata[asset] = CachedMetadata({
                liquidity: liquidities[i],
                marketCap: marketCaps[i],
                volume: volumes[i],
                updatedAt: block.timestamp
            });

            emit MetadataUpdated(asset, liquidities[i], marketCaps[i], volumes[i]);
        }
    }

    // ─── Owner Admin ────────────────────────────────────────────────────

    function setPonsBondingCurve(address _ponsBondingCurve) external onlyOwner {
        ponsBondingCurve = _ponsBondingCurve;
        emit PonsBondingCurveSet(_ponsBondingCurve);
    }

    function setThresholds(
        uint256 _minLiquidity,
        uint256 _minVolume,
        uint256 _minMarketCap
    ) external onlyOwner {
        minLiquidity = _minLiquidity;
        minVolume = _minVolume;
        minMarketCap = _minMarketCap;
        emit ThresholdsUpdated(_minLiquidity, _minVolume, _minMarketCap);
    }

    function setManualGraduated(address asset, bool graduated) external onlyOwner {
        require(asset != address(0), "Adapter: Zero address");
        manualGraduated[asset] = graduated;
        if (!_isKnown[asset]) {
            knownAssets.push(asset);
            _isKnown[asset] = true;
        }
        emit ManualGraduatedSet(asset, graduated);
    }

    function setManualEligible(address asset, bool eligible) external onlyOwner {
        require(asset != address(0), "Adapter: Zero address");
        manualEligible[asset] = eligible;
        emit ManualEligibilitySet(asset, eligible);
    }

    function setManualBlock(address asset, bool blocked) external onlyOwner {
        require(asset != address(0), "Adapter: Zero address");
        manualBlocked[asset] = blocked;
        emit ManualBlockSet(asset, blocked);
    }

    function setUpdater(address updater, bool status) external onlyOwner {
        require(updater != address(0), "Adapter: Zero address");
        isUpdater[updater] = status;
        emit UpdaterSet(updater, status);
    }

    // ─── View helpers ───────────────────────────────────────────────────

    function getKnownAssetCount() external view returns (uint256) {
        return knownAssets.length;
    }

    /**
     * @notice Return all known assets that currently pass eligibility checks.
     */
    function getEligibleAssets() external view returns (address[] memory) {
        uint256 total = knownAssets.length;
        address[] memory temp = new address[](total);
        uint256 count = 0;

        for (uint256 i = 0; i < total; i++) {
            if (isEligible(knownAssets[i])) {
                temp[count] = knownAssets[i];
                count++;
            }
        }

        address[] memory result = new address[](count);
        for (uint256 j = 0; j < count; j++) {
            result[j] = temp[j];
        }
        return result;
    }

    /**
     * @notice Return all known graduated assets (eligible or not).
     */
    function getGraduatedAssets() external view returns (address[] memory) {
        uint256 total = knownAssets.length;
        address[] memory temp = new address[](total);
        uint256 count = 0;

        for (uint256 i = 0; i < total; i++) {
            if (isGraduated(knownAssets[i])) {
                temp[count] = knownAssets[i];
                count++;
            }
        }

        address[] memory result = new address[](count);
        for (uint256 j = 0; j < count; j++) {
            result[j] = temp[j];
        }
        return result;
    }
}
