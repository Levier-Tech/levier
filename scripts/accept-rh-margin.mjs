import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { context, artifact, assert, same, json, submit, v, safeFailure } from './lib/rh-live.mjs';
import { acquireLock } from './lib/process-lock.mjs';
import { publishReference, publisherPolicy } from './lib/rh-publisher.mjs';
import { readMarginSnapshot, marginOrder } from '../apps/web/src/lib/margin-client.ts';
let ctx, release, activated=false;
const runId=`margin-accept-${randomUUID()}`;
async function status(value) {
  const d=ctx.state.descriptor, m=ctx.state.margin.descriptor;
  for(const market of [d,m.short]) {
    const abi=artifact('LevierMarketRegistry').abi;
    const current=await ctx.client.readContract({address:d.registry,abi,functionName:'getMarket',args:[market.marketId]});
    if(current.status!==value) await submit(ctx,`${runId}-status-${market.marketId}-${value}`,ctx.deployer,{to:d.registry,data:v.encodeFunctionData({abi,functionName:'setMarketStatus',args:[market.marketId,value]})});
  }
}
try {
  assert(process.argv.length===3&&process.argv[2]==='.env.testnet','EXPLICIT_TESTNET_PROFILE_REQUIRED');
  release=acquireLock('.secrets/rh-live/operations.lock');
  ctx=await context(process.argv[2]);
  const {client,state,env,deployer}=ctx,d=state.descriptor,m=state.margin.descriptor;
  const policy=publisherPolicy(env.RH_PUBLISHER_POLICY_JSON,JSON.parse(env.RH_REFERENCE_BINDING_JSON));
  const plan=JSON.parse(env.RH_MARGIN_PLAN_JSON);
  await readMarginSnapshot(client,m,d,deployer.address);
  state.margin.acceptance ??= {sides:{}};
  const acceptance=state.margin.acceptance;
  const routerAbi=artifact('MarginRouter').abi,pairAbi=artifact('LevierPair').abi;
  const balance=token=>client.readContract({address:token,abi:v.erc20Abi,functionName:'balanceOf',args:[deployer.address]});
  const call=async(id,to,abi,functionName,args)=>{
    const operation=`margin-accept-v1-${id}`,data=v.encodeFunctionData({abi,functionName,args});
    if(state.operations[operation])return submit(ctx,operation,deployer,{to,data});
    const gas=((await client.estimateGas({account:deployer.address,to,data}))*BigInt(m.policy.gasBufferBps)+9999n)/10000n;
    assert(gas<=BigInt(m.policy.maxGasLimit),'GAS_LIMIT_EXCEEDED');
    return submit(ctx,operation,deployer,{to,data,gas});
  };
  for(const isShort of [false,true]) {
    const side=isShort?'short':'long',pair=isShort?m.short.pair:d.pair;
    if(acceptance.sides[side]?.complete)continue;
    await publishReference(ctx,policy.minimumFreshSeconds);
    activated=true;
    await status(0);
    const s=acceptance.sides[side]??={};
    if(!s.before) {
      const account=await client.readContract({address:pair,abi:pairAbi,functionName:'accounts',args:[deployer.address]});
      assert(account[0]===0n&&account[1]===0n,'ACCEPTANCE_REQUIRES_EMPTY_ACCOUNT');
      s.before={stock:String(await balance(d.collateral)),stable:String(await balance(d.debt))};ctx.persist();
    }
    if(!state.operations[`margin-accept-v1-${side}-open`]) {
      const snapshot=await readMarginSnapshot(client,m,d,deployer.address);
      const order=marginOrder(m,d,snapshot,isShort,v.formatUnits(BigInt(plan.acceptanceMarginRaw),d.debtDecimals),isShort?10000:15000);
      s.openArgs=[isShort,String(order.margin),String(order.debt),String(order.minCollateral),String((await client.getBlock()).timestamp+BigInt(m.policy.deadlineSeconds))];ctx.persist();
    }
    await call(`${side}-approve`,d.debt,v.erc20Abi,'approve',[m.router,BigInt(plan.acceptanceMarginRaw)]);
    await call(`${side}-operator`,pair,pairAbi,'setOperator',[m.router,true]);
    const open=await call(`${side}-open`,m.router,routerAbi,'open',s.openArgs.map((x,i)=>i===0?x:BigInt(x)));
    const event=(receipt,name)=>{
      const events=receipt.logs.filter(x=>same(x.address,m.router)).flatMap(log=>{try {const e=v.decodeEventLog({abi:routerAbi,data:log.data,topics:log.topics});return e.eventName===name?[e.args]:[];}catch{return[];}});
      assert(events.length===1&&same(events[0].user,deployer.address)&&events[0].isShort===isShort,'MARGIN_EVENT_MISMATCH');return events[0];
    };
    const opened=event(open,'PositionOpened');
    const position=await client.readContract({address:pair,abi:pairAbi,functionName:'accounts',args:[deployer.address],blockNumber:open.blockNumber});
    assert(position[0]===opened.collateral&&position[1]===opened.debt,'OPEN_POSITION_MISMATCH');
    const closeId=s.closeRetryId??`${side}-close`;
    if(!state.operations[`margin-accept-v1-${closeId}`]) {
      const quote=await client.readContract({address:m.router,abi:routerAbi,functionName:'quoteClose',args:[isShort,deployer.address]});
      s.closeArgs=[isShort,String(quote*BigInt(10000-m.policy.slippageBps)/10000n),String((await client.getBlock()).timestamp+BigInt(m.policy.deadlineSeconds))];ctx.persist();
    }
    const close=await call(closeId,m.router,routerAbi,'close',s.closeArgs.map((x,i)=>i===0?x:BigInt(x)));
    const closed=event(close,'PositionClosed');
    const afterPosition=await client.readContract({address:pair,abi:pairAbi,functionName:'accounts',args:[deployer.address]});
    assert(afterPosition[0]===0n&&afterPosition[1]===0n,'POSITION_NOT_CLOSED');
    for(const token of [d.collateral,d.debt]) {
      assert(await client.readContract({address:token,abi:v.erc20Abi,functionName:'balanceOf',args:[m.router]})===0n,'ROUTER_DUST');
      for(const target of [d.pair,m.short.pair])assert(await client.readContract({address:token,abi:v.erc20Abi,functionName:'allowance',args:[m.router,target]})===0n,'ROUTER_ALLOWANCE_REMAINING');
    }
    assert(await balance(d.collateral)===BigInt(s.before.stock),'USER_STOCK_BALANCE_CHANGED');
    assert(await balance(d.debt)===BigInt(s.before.stable)-BigInt(plan.acceptanceMarginRaw)+closed.stableReturned,'USER_STABLE_BALANCE_MISMATCH');
    await call(`${side}-revoke`,pair,pairAbi,'setOperator',[m.router,false]);
    s.result={side,openHash:open.transactionHash,openBlock:open.blockNumber,closeHash:close.transactionHash,closeBlock:close.blockNumber,opened,closed,stockBalanceUnchanged:true,finalCollateral:'0',finalDebt:'0',routerDust:'0',stableCostRaw:BigInt(plan.acceptanceMarginRaw)-closed.stableReturned};
    s.complete=true;ctx.persist();console.log(json(s.result));
  }
  acceptance.complete=true;ctx.persist();
  mkdirSync('docs/evidence/rh-margin',{recursive:true});
  writeFileSync('docs/evidence/rh-margin/acceptance.json',json({capturedAt:new Date().toISOString(),chainId:46630,account:deployer.address,router:m.router,pool:m.pool,longPair:d.pair,shortPair:m.short.pair,method:'Signed real testnet transactions with canonical receipt, event, account, balance and allowance checks. No browser wallet signing claimed.',sides:Object.values(acceptance.sides).map(s=>s.result)})+'\n');
} catch(error) {safeFailure(error);}
finally {if(ctx&&activated)try{await status(2);}catch(error){safeFailure(error);}release?.();}
