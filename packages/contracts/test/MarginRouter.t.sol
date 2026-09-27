// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "forge-std/Test.sol";
import "../src/trading/MarginRouter.sol";
import "../src/trading/RhShortReferenceOracle.sol";
import "../src/oracle/RhTestnetReferenceOracle.sol";
import "../src/tokens/TestnetERC20.sol";
interface IV2FactoryTest {function createPair(address,address) external returns(address);}
interface IV2MintTest {function mint(address) external returns(uint256);}
contract MarginRouterTest is Test {
 TestnetERC20 stock;TestnetERC20 stable;LeveraMarketRegistry registry;LeveraPair longPair;LeveraPair shortPair;
 RhTestnetReferenceOracle oracle;RhShortReferenceOracle shortOracle;MarginRouter router;address pool;
 address alice=makeAddr("alice");address bob=makeAddr("bob");
 function setUp() public {
  vm.chainId(46630);vm.warp(100000);
  stock=new TestnetERC20("Stock fixture","TSLA",18,10000e18,address(this));stable=new TestnetERC20("Stable fixture","USDG",6,1000000e6,address(this));
  bytes32 binding=keccak256("reviewed fixture binding");
  oracle=new RhTestnetReferenceOracle(address(this),binding,RhTestnetReferenceOracle.Policy(address(stock),1000,1e18,1000e18),RhTestnetReferenceOracle.Policy(address(stable),1000,0.9e18,1.1e18),500);
  oracle.publish(250e18,block.timestamp,1e18,block.timestamp,keccak256("observation"));
  shortOracle=new RhShortReferenceOracle(address(oracle),binding,address(stock),address(stable),50);
  registry=new LeveraMarketRegistry(address(this));
  bytes32 longId=keccak256(abi.encodePacked("long",address(stock),address(stable)));
  bytes32 shortId=keccak256(abi.encodePacked("short",address(stable),address(stock)));
  longPair=new LeveraPair(longId,address(stock),address(stable),address(oracle),address(registry),address(this));
  shortPair=new LeveraPair(shortId,address(stable),address(stock),address(shortOracle),address(registry),address(this));
  registry.addMarket("long",address(stock),address(stable),address(longPair),address(oracle),LeveraMarketRegistry.RiskTier.Experimental,5000,6500,20000,100e18,10000e6);
  registry.addMarket("short",address(stable),address(stock),address(shortPair),address(shortOracle),LeveraMarketRegistry.RiskTier.Experimental,6000,7500,20000,10000e6,100e18);
  bytes memory creation=abi.encodePacked(vm.parseBytes(vm.readFile("vendor/uniswap-v2-core/Factory.creation.txt")),abi.encode(address(this)));
  address factory;assembly {factory:=create(0,add(creation,32),mload(creation))}require(factory!=address(0));
  pool=IV2FactoryTest(factory).createPair(address(stock),address(stable));
  stable.transfer(address(longPair),1000e6);stock.transfer(address(shortPair),10e18);
  router=new MarginRouter(address(stock),address(stable),address(longPair),address(shortPair),pool,address(this));registry.setAuthorizedRouter(address(router),true);router.setPaused(false);stock.approve(address(router),100e18);stable.approve(address(router),25000e6);router.seedLiquidity(100e18,25000e6,1,block.timestamp+60);
  stable.transfer(alice,1000e6);vm.startPrank(alice);stable.approve(address(router),1000e6);longPair.setOperator(address(router),true);shortPair.setOperator(address(router),true);vm.stopPrank();
 }
 function openPosition(bool isShort) internal {vm.prank(alice);router.open(isShort,10e6,isShort?0.04e18:5e6,1,block.timestamp+60);}
 function testRealV2LongAndShortCloseWithoutExternalDebtPayment() public {
  for(uint256 i;i<2;i++){
   bool isShort=i==1;uint256 before_=stable.balanceOf(alice);openPosition(isShort);LeveraPair pair=isShort?shortPair:longPair;
   (uint256 coll,uint256 debt)=pair.accounts(alice);assertGt(coll,0);assertGt(debt,0);assertEq(stable.balanceOf(alice),before_-10e6);assertEq(stock.balanceOf(alice),0);
   uint256 quoted=router.quoteClose(isShort,alice);vm.prank(alice);uint256 returned=router.close(isShort,9e6,block.timestamp+60);assertEq(returned,quoted);
   (coll,debt)=pair.accounts(alice);assertEq(coll,0);assertEq(debt,0);assertGt(stable.balanceOf(alice),before_-1e6);assertLt(stable.balanceOf(alice),before_);
   assertEq(stock.balanceOf(address(router)),0);assertEq(stable.balanceOf(address(router)),0);assertEq(stock.allowance(address(router),address(pair)),0);assertEq(stable.allowance(address(router),address(pair)),0);
  }
 }
 function testCloseStillWorksWhilePausedAndOracleExpired() public {openPosition(false);router.setPaused(true);registry.setMarketStatus(longPair.marketId(),LeveraMarketRegistry.MarketStatus.PAUSED);vm.warp(block.timestamp+2000);vm.prank(alice);router.close(false,9e6,block.timestamp+60);(uint256 c,uint256 d)=longPair.accounts(alice);assertEq(c+d,0);}
 function testShortPricesAreConservativeAndExpireWithSource() public {assertEq(shortOracle.getPrice(address(stock)),251.25e18);assertLt(shortOracle.getPrice(address(stable)),1e18);vm.warp(block.timestamp+1001);vm.expectRevert("Reference: Expired price");shortOracle.getPrice(address(stock));}
 function testSpoofedOrUnsolicitedPoolCallbackRejected() public {vm.expectRevert("Margin: Invalid callback");router.uniswapV2Call(address(router),1,0,"");vm.prank(pool);vm.expectRevert("Margin: Invalid callback");router.uniswapV2Call(address(router),1,0,"");}
 function testMissingOperatorConsentRollsBackAllSwapsAndTransfers() public {stable.transfer(bob,100e6);vm.startPrank(bob);stable.approve(address(router),100e6);vm.expectRevert("Pair: Caller is not authorized for user");router.open(false,10e6,5e6,1,block.timestamp+60);vm.stopPrank();assertEq(stable.balanceOf(bob),100e6);(uint256 c,uint256 d)=longPair.accounts(bob);assertEq(c+d,0);}
 function testSlippageAndDeadlineGuardsPreservePosition() public {vm.prank(alice);vm.expectRevert("Margin: Slippage");router.open(false,10e6,5e6,1e18,block.timestamp+60);openPosition(false);(uint256 c,uint256 d)=longPair.accounts(alice);vm.prank(alice);vm.expectRevert("Margin: Slippage");router.close(false,100e6,block.timestamp+60);(uint256 afterC,uint256 afterD)=longPair.accounts(alice);assertEq(c,afterC);assertEq(d,afterD);vm.prank(alice);vm.expectRevert("Margin: Expired");router.close(false,1,block.timestamp-1);}
 function testCannotOpenOnExistingLendingPositionOrStealAnotherWallet() public {openPosition(false);vm.prank(alice);vm.expectRevert("Margin: Existing position");router.open(false,10e6,5e6,1,block.timestamp+60);vm.prank(bob);vm.expectRevert("Margin: No position");router.close(false,1,block.timestamp+60);}
 function testDebtFreeCloseAfterManualRepayment() public {openPosition(false);vm.startPrank(alice);stable.approve(address(longPair),5e6);longPair.repay(5e6);router.close(false,14e6,block.timestamp+60);vm.stopPrank();(uint256 c,uint256 d)=longPair.accounts(alice);assertEq(c+d,0);}
 function testFuzzRoundTripDoesNotCreateValueOrLeaveDust(uint256 amount,bool isShort) public {amount=bound(amount,1e6,100e6);uint256 before_=stable.balanceOf(alice);uint256 borrowed=isShort?amount*1e12/250:amount/2;vm.startPrank(alice);router.open(isShort,amount,borrowed,1,block.timestamp+60);router.close(isShort,amount*95/100,block.timestamp+60);vm.stopPrank();assertLe(stable.balanceOf(alice),before_);assertEq(stock.balanceOf(address(router))+stable.balanceOf(address(router)),0);}
}
