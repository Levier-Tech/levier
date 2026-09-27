// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../core/LeveraPair.sol";
interface IV2Pool {
    function token0() external view returns(address);
    function token1() external view returns(address);
    function getReserves() external view returns(uint112,uint112,uint32);
    function swap(uint256,uint256,address,bytes calldata) external;
    function totalSupply() external view returns(uint256);
    function mint(address) external returns(uint256);
}
/// @notice Atomic margin trading against a pinned Uniswap V2 0.30% pool and two isolated lending pairs.
/// @dev Only one aggregate position per wallet/side; open requires an empty pair account.
///      Flash swaps repay in the other asset. Closing pays debt from collateral, without a wallet top-up.
contract MarginRouter is ReentrancyGuard,Ownable {
    using SafeERC20 for IERC20;
    IERC20 public immutable stock;
    IERC20 public immutable stable;
    LeveraPair public immutable longPair;
    LeveraPair public immutable shortPair;
    IV2Pool public immutable pool;
    bool public immutable stockIsToken0;
    bool public isPaused=true;
    bytes32 private activeCall;
    struct Operation {address user;bool isShort;bool closing;uint256 collateral;uint256 debt;uint256 owed;uint256 output;}
    event PauseUpdated(bool paused);
    event PositionOpened(address indexed user,bool indexed isShort,uint256 margin,uint256 collateral,uint256 debt);
    event PositionClosed(address indexed user,bool indexed isShort,uint256 collateral,uint256 debt,uint256 stableReturned);
    constructor(address stock_,address stable_,address long_,address short_,address pool_,address owner_) Ownable(owner_) {
        require(stock_!=stable_&&stock_.code.length>0&&stable_.code.length>0&&pool_.code.length>0,"Margin: Invalid assets");
        stock=IERC20(stock_);stable=IERC20(stable_);longPair=LeveraPair(long_);shortPair=LeveraPair(short_);pool=IV2Pool(pool_);
        require(address(longPair.collateralToken())==stock_&&address(longPair.debtToken())==stable_&&address(shortPair.collateralToken())==stable_&&address(shortPair.debtToken())==stock_,"Margin: Pair assets");
        require(address(longPair.registry())==address(shortPair.registry()),"Margin: Registry mismatch");
        stockIsToken0=pool.token0()==stock_;
        require((stockIsToken0&&pool.token1()==stable_)||(!stockIsToken0&&pool.token0()==stable_&&pool.token1()==stock_),"Margin: Pool assets");
    }
    function setPaused(bool paused) external onlyOwner {isPaused=paused;emit PauseUpdated(paused);}
    /// @notice Atomically seed the empty pinned pool; the owner receives the actual V2 LP tokens.
    function seedLiquidity(uint256 stockAmount,uint256 stableAmount,uint256 minLiquidity,uint256 deadline) external onlyOwner nonReentrant returns(uint256 liquidity) {
        require(block.timestamp<=deadline&&stockAmount>0&&stableAmount>0&&minLiquidity>0,"Margin: Invalid seed");
        require(pool.totalSupply()==0&&stock.balanceOf(address(pool))==0&&stable.balanceOf(address(pool))==0,"Margin: Pool not empty");
        stock.safeTransferFrom(msg.sender,address(pool),stockAmount);stable.safeTransferFrom(msg.sender,address(pool),stableAmount);
        require(stock.balanceOf(address(pool))==stockAmount&&stable.balanceOf(address(pool))==stableAmount,"Margin: Unsupported transfer");
        liquidity=pool.mint(msg.sender);require(liquidity>=minLiquidity,"Margin: LP slippage");
    }
    function reserves() public view returns(uint256 stockReserve,uint256 stableReserve) {
        (uint112 r0,uint112 r1,)=pool.getReserves();return stockIsToken0?(r0,r1):(r1,r0);
    }
    function quoteExactInput(bool stockIn,uint256 amount) public view returns(uint256) {
        (uint256 s,uint256 u)=reserves();(uint256 input,uint256 output)=stockIn?(s,u):(u,s);
        require(amount>0&&input>0&&output>0,"Margin: No liquidity");
        uint256 adjusted=amount*997;return adjusted*output/(input*1000+adjusted);
    }
    function quoteExactOutput(bool stockOut,uint256 amount) public view returns(uint256) {
        (uint256 s,uint256 u)=reserves();(uint256 input,uint256 output)=stockOut?(u,s):(s,u);
        require(amount>0&&amount<output&&input>0,"Margin: Insufficient liquidity");
        return input*amount*1000/((output-amount)*997)+1;
    }
    function _receiveMargin(uint256 amount) private {
        uint256 before_=stable.balanceOf(address(this));stable.safeTransferFrom(msg.sender,address(this),amount);
        require(stable.balanceOf(address(this))==before_+amount,"Margin: Unsupported transfer");
    }
    function _flash(bool stockOut,uint256 amount,Operation memory op) private {
        bytes memory data=abi.encode(op);activeCall=keccak256(data);
        bool zero=stockOut==stockIsToken0;
        pool.swap(zero?amount:0,zero?0:amount,address(this),data);
        require(activeCall==bytes32(0),"Margin: Missing callback");
    }
    function open(bool isShort,uint256 margin,uint256 borrowAmount,uint256 minCollateral,uint256 deadline) external nonReentrant {
        require(!isPaused,"Margin: Paused");require(block.timestamp<=deadline,"Margin: Expired");
        require(margin>0&&borrowAmount>0&&minCollateral>0,"Margin: Zero amount");
        LeveraPair pair=isShort?shortPair:longPair;
        (uint256 oldCollateral,uint256 oldDebt)=pair.accounts(msg.sender);
        require(oldCollateral==0&&oldDebt==0,"Margin: Existing position");
        uint256 output=quoteExactInput(isShort,isShort?borrowAmount:margin+borrowAmount);
        uint256 collateral=isShort?margin+output:output;
        require(collateral>=minCollateral,"Margin: Slippage");
        _receiveMargin(margin);
        _flash(!isShort,output,Operation(msg.sender,isShort,false,collateral,borrowAmount,isShort?borrowAmount:margin+borrowAmount,output));
        emit PositionOpened(msg.sender,isShort,margin,collateral,borrowAmount);
    }
    function quoteClose(bool isShort,address user) external view returns(uint256) {
        LeveraPair pair=isShort?shortPair:longPair;
        (uint256 collateral,uint256 debt)=pair.accounts(user);
        if(collateral==0)return 0;
        if(debt==0)return isShort?collateral:quoteExactInput(true,collateral);
        uint256 owed=quoteExactOutput(isShort,debt);
        require(collateral>owed,"Margin: Insufficient equity");
        if(isShort)return collateral-owed;
        (uint256 s,uint256 u)=reserves();
        uint256 adjusted=(collateral-owed)*997;
        return adjusted*(u-debt)/((s+owed)*1000+adjusted);
    }
    function close(bool isShort,uint256 minStableOut,uint256 deadline) external nonReentrant returns(uint256 returned) {
        require(block.timestamp<=deadline,"Margin: Expired");require(minStableOut>0,"Margin: Zero minimum");
        LeveraPair pair=isShort?shortPair:longPair;
        (uint256 collateral,uint256 debt)=pair.accounts(msg.sender);require(collateral>0,"Margin: No position");
        uint256 remaining=collateral;
        if(debt>0) {
            uint256 owed=quoteExactOutput(isShort,debt);
            require(collateral>owed,"Margin: Insufficient equity");remaining=collateral-owed;
            _flash(isShort,debt,Operation(msg.sender,isShort,true,collateral,debt,owed,debt));
        } else pair.withdrawCollateralFor(msg.sender,collateral,address(this));
        if(isShort){returned=remaining;stable.safeTransfer(msg.sender,remaining);}
        else {
            returned=quoteExactInput(true,remaining);require(returned>0,"Margin: No output");
            stock.safeTransfer(address(pool),remaining);
            pool.swap(stockIsToken0?0:returned,stockIsToken0?returned:0,msg.sender,"");
        }
        require(returned>=minStableOut,"Margin: Slippage");
        emit PositionClosed(msg.sender,isShort,collateral,debt,returned);
    }
    function uniswapV2Call(address sender,uint256 amount0,uint256 amount1,bytes calldata data) external {
        require(msg.sender==address(pool)&&sender==address(this)&&activeCall!=bytes32(0)&&keccak256(data)==activeCall,"Margin: Invalid callback");
        delete activeCall;
        Operation memory op=abi.decode(data,(Operation));
        bool stockOut=op.closing?op.isShort:!op.isShort;
        bool zero=stockOut==stockIsToken0;
        require((zero?amount0:amount1)==op.output&&(zero?amount1:amount0)==0,"Margin: Invalid output");
        LeveraPair pair=op.isShort?shortPair:longPair;
        IERC20 collateral=op.isShort?stable:stock;IERC20 debt=op.isShort?stock:stable;
        if(op.closing){
            debt.forceApprove(address(pair),op.debt);pair.repayFor(op.user,op.debt);debt.forceApprove(address(pair),0);
            pair.withdrawCollateralFor(op.user,op.collateral,address(this));collateral.safeTransfer(address(pool),op.owed);
        } else {
            collateral.forceApprove(address(pair),op.collateral);pair.depositCollateralFor(op.user,op.collateral);collateral.forceApprove(address(pair),0);
            pair.borrowFor(op.user,op.debt,address(this));debt.safeTransfer(address(pool),op.owed);
        }
    }
}
