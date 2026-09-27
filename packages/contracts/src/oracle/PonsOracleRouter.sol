// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./IPonsOracleRouter.sol";
import "./IDexTwapOracle.sol";
import "./CompositeSanityOracle.sol";

/**
 * @title PonsOracleRouter
 * @notice Validates fast off-chain prices against on-chain DEX TWAP.
 * @dev Protects Pons leveraged positions from spot manipulation or oracle attacks.
 */
contract PonsOracleRouter is IPonsOracleRouter, Ownable {
    CompositeSanityOracle public immutable primaryOracle;
    IDexTwapOracle public dexTwapOracle;

    struct AssetOracleConfig {
        uint32 twapWindow;
        uint256 maxDeviationBps;
        bool useTwapValidation;
    }

    mapping(address => AssetOracleConfig) public oracleConfigs;

    event ConfigUpdated(address indexed asset, uint32 twapWindow, uint256 maxDeviationBps, bool useTwapValidation);
    event DexTwapOracleUpdated(address newOracle);

    constructor(
        address _primaryOracle,
        address _dexTwapOracle,
        address _initialOwner
    ) Ownable(_initialOwner) {
        require(_primaryOracle != address(0), "Router: Zero primary oracle");
        primaryOracle = CompositeSanityOracle(_primaryOracle);
        dexTwapOracle = IDexTwapOracle(_dexTwapOracle);
    }

    function setDexTwapOracle(address _dexTwapOracle) external onlyOwner {
        dexTwapOracle = IDexTwapOracle(_dexTwapOracle);
        emit DexTwapOracleUpdated(_dexTwapOracle);
    }

    function setAssetConfig(
        address asset,
        uint32 twapWindow,
        uint256 maxDeviationBps,
        bool useTwapValidation
    ) external onlyOwner {
        require(asset != address(0), "Router: Zero asset");
        require(twapWindow >= 60 || !useTwapValidation, "Router: TWAP window too short");
        require(maxDeviationBps > 0 && maxDeviationBps <= 5000, "Router: Invalid deviation"); // max 50%
        
        oracleConfigs[asset] = AssetOracleConfig({
            twapWindow: twapWindow,
            maxDeviationBps: maxDeviationBps,
            useTwapValidation: useTwapValidation
        });

        emit ConfigUpdated(asset, twapWindow, maxDeviationBps, useTwapValidation);
    }

    /**
     * @inheritdoc IPonsOracleRouter
     */
    function getMarkPrice(address asset) external view override returns (uint256 markPrice) {
        uint256 primaryPrice = primaryOracle.getPrice(asset);
        
        AssetOracleConfig memory config = oracleConfigs[asset];
        
        if (config.useTwapValidation && address(dexTwapOracle) != address(0)) {
            uint256 twapPrice = dexTwapOracle.getTwapPrice(asset, config.twapWindow);
            
            uint256 diff = primaryPrice > twapPrice ? primaryPrice - twapPrice : twapPrice - primaryPrice;
            uint256 deviationBps = (diff * 10_000) / twapPrice;
            
            require(deviationBps <= config.maxDeviationBps, "PonsOracle: Deviation exceeds maximum allowed");
        }
        
        return primaryPrice;
    }

    /**
     * @inheritdoc IPonsOracleRouter
     */
    function getPriceDiagnostics(address asset) external view override returns (
        uint256 primaryPrice,
        uint256 twapPrice,
        uint256 deviationBps,
        bool isSafe
    ) {
        primaryPrice = primaryOracle.getPrice(asset);
        AssetOracleConfig memory config = oracleConfigs[asset];
        
        if (config.useTwapValidation && address(dexTwapOracle) != address(0)) {
            twapPrice = dexTwapOracle.getTwapPrice(asset, config.twapWindow);
            
            if (twapPrice > 0) {
                uint256 diff = primaryPrice > twapPrice ? primaryPrice - twapPrice : twapPrice - primaryPrice;
                deviationBps = (diff * 10_000) / twapPrice;
                isSafe = deviationBps <= config.maxDeviationBps;
            } else {
                isSafe = false;
            }
        } else {
            twapPrice = 0;
            deviationBps = 0;
            isSafe = true;
        }
    }
}
