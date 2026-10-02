// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {VerifiedFeedOracle} from "../src/oracle/VerifiedFeedOracle.sol";
import {IPonsFactory} from "../src/ponsperp/IPonsFactory.sol";
import {PonsV4TwapOracle} from "../src/ponsperp/PonsV4TwapOracle.sol";
import {PonsLiquidityVault} from "../src/ponsperp/PonsLiquidityVault.sol";
import {PonsPerpManager} from "../src/ponsperp/PonsPerpManager.sol";

/// @notice Runs against Robinhood Chain mainnet state. Skipped unless PONS_FORK_RPC is set:
/// PONS_FORK_RPC=https://rpc.mainnet.chain.robinhood.com forge test --match-contract PonsPerpMainnetFork
contract PonsPerpMainnetForkTest is Test {
    address constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant PONS_FACTORY = 0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e;
    address constant PONS_HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;
    address constant FEED_ORACLE = 0x44665e0809d5116d37aB9981046e177b070471d9;
    address constant ETH_USD_FEED = 0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant OWNER = 0xd09D9c87ECfe008B4D6D3cEbeAd25103c16d9a7C;
    address constant LEVIER = 0xeC0b618cAdd930791329E834E11DCfD8213249C0;
    address constant GRADUATED = 0x492F71Fb6CB10F923b0740436F5CD39c7c9a177A; // LEVERA, graduated

    PonsV4TwapOracle oracle;
    PonsLiquidityVault vault;
    PonsPerpManager manager;

    function setUp() public {
        string memory rpc = vm.envOr("PONS_FORK_RPC", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);

        vm.prank(OWNER);
        VerifiedFeedOracle(FEED_ORACLE).addFeed(
            VerifiedFeedOracle.FeedInput(WETH, ETH_USD_FEED, "ETH / USD", 26 hours, 100e18, 100_000e18, false)
        );

        oracle = PonsV4TwapOracle(
            address(
                new ERC1967Proxy(
                    address(new PonsV4TwapOracle()),
                    abi.encodeCall(
                        PonsV4TwapOracle.initialize, (OWNER, POOL_MANAGER, PONS_FACTORY, PONS_HOOK, FEED_ORACLE, WETH)
                    )
                )
            )
        );
        vault = PonsLiquidityVault(
            address(
                new ERC1967Proxy(
                    address(new PonsLiquidityVault()),
                    abi.encodeCall(PonsLiquidityVault.initialize, (IERC20(USDG), "Levier Pons LP", "lpPONS", OWNER))
                )
            )
        );
        manager = PonsPerpManager(
            address(
                new ERC1967Proxy(
                    address(new PonsPerpManager()),
                    abi.encodeCall(PonsPerpManager.initialize, (OWNER, USDG, address(oracle), address(vault), PONS_FACTORY))
                )
            )
        );
        vm.startPrank(OWNER);
        vault.setManager(address(manager));
        oracle.listAsset(LEVIER);
        oracle.listAsset(GRADUATED);
        vm.stopPrank();
    }

    function testGraduatedPoolPricesInUsd() public {
        for (uint256 i; i < 9; ++i) {
            oracle.poke(GRADUATED);
            vm.warp(vm.getBlockTimestamp() + 4 minutes);
        }
        (uint256 spot, uint256 twap) = oracle.update(GRADUATED);
        emit log_named_decimal_uint("LEVERA spot USD", spot, 18);
        assertGt(spot, 0);
        assertEq(spot, twap); // the pool did not move on the fork
    }

    function testLevierListedButNotOpenUntilGraduation() public {
        IPonsFactory.LaunchedToken memory launch = IPonsFactory(PONS_FACTORY).getLaunchedToken(LEVIER);
        (bytes32 poolId,,,,,) = oracle.assets(LEVIER);
        assertEq(poolId, keccak256(abi.encode(address(0), LEVIER, launch.poolFee, launch.tickSpacing, PONS_HOOK)));
        if (launch.phase == 2) return; // graduated since this test was written
        vm.expectRevert(PonsV4TwapOracle.PoolNotInitialized.selector);
        oracle.poke(LEVIER);

        vm.startPrank(OWNER);
        manager.setMarket(LEVIER, 20_000, 1_000, 20e6, 100e6);
        manager.setOpeningPaused(false);
        vm.stopPrank();
        vm.expectRevert(PonsPerpManager.NotGraduated.selector);
        manager.openPosition(LEVIER, true, 1e6, 20_000);
    }
}
