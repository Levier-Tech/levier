import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {assert,v,json,save,safeFailure} from './lib/rh-live.mjs';
import {readMarginSnapshot,marginOrder} from '../apps/web/src/lib/margin-client.ts';
import environment from '../apps/web/config/environment.cjs';
try {
  assert(process.argv.length===3&&process.argv[2]==='.env.testnet','EXPLICIT_TESTNET_PROFILE_REQUIRED');
  const env=parseEnv(readFileSync(process.argv[2],'utf8')),config=environment.validate(environment.clientSchema,env);
  assert(config.MARGIN_DEPLOYMENT_JSON&&config.LENDING_DEPLOYMENT_JSON,'MARGIN_CONFIGURATION_REQUIRED');
  const client=v.createPublicClient({transport:v.http(env.RPC_URL,{retryCount:0,timeout:Number(env.RPC_TIMEOUT_MS)}),cacheTime:0});
  const d=config.MARGIN_DEPLOYMENT_JSON,long=config.LENDING_DEPLOYMENT_JSON,s=await readMarginSnapshot(client,d,long,env.TESTER_ADDRESS);
  const policy=JSON.parse(env.RH_PUBLISHER_POLICY_JSON),health=existsSync(policy.healthPath)?JSON.parse(readFileSync(policy.healthPath,'utf8')):null;
  let processAlive=false;if(health)try{process.kill(health.pid,0);processAlive=true;}catch{}
  const heartbeatFresh=!!health&&Date.now()-Date.parse(health.updatedAt)<JSON.parse(env.RH_REFERENCE_BINDING_JSON).stockMaxAgeSeconds*1000&&Date.now()<Date.parse(health.expiresAt);
  const gas=await client.getBalance({address:env.TESTER_ADDRESS}),web=parseEnv(readFileSync('apps/web/.env','utf8'));
  const sides=[false,true].map(isShort=>{
    const p=isShort?s.shortPosition:s.longPosition;let canQuote=false;
    try {marginOrder(d,long,s,isShort,v.formatUnits(BigInt(d.policy.maxMarginRaw),long.debtDecimals),(isShort?d.policy.shortExposureBps:d.policy.longLeveragesBps)[0]);canQuote=true;}catch{}
    return {side:isShort?'short':'long',marketStatus:p.status,oracleAvailable:p.oracleAvailable,collateralRaw:p.collateral,debtRaw:p.debt,liquidityRaw:p.liquidity,canQuoteMaxMargin:canQuote};
  });
  const result={capturedAt:new Date().toISOString(),chainId:config.CHAIN_ID,routerPaused:s.paused,sides,pool:{tsla:v.formatUnits(s.reserves[0],long.collateralDecimals),usdg:v.formatUnits(s.reserves[1],long.debtDecimals)},tester:{usdg:v.formatUnits(s.longPosition.debtBalance,long.debtDecimals),gasEth:v.formatEther(gas)},publisher:{status:health?.status??'not-started',processAlive,heartbeatFresh,expiresAt:health?.expiresAt??null},webGateConfigured:web.MARGIN_TRADING_ENABLED==='true',readyForSupervisedBrowserTest:!s.paused&&sides.every(s=>s.marketStatus===0&&s.oracleAvailable&&s.canQuoteMaxMargin)&&processAlive&&heartbeatFresh&&health?.status==='healthy'&&gas>0n&&web.MARGIN_TRADING_ENABLED==='true',note:'Read-only onchain readiness; does not prove browser wallet signing or guarantee later availability.'};
  mkdirSync('docs/evidence/rh-margin',{recursive:true});save('docs/evidence/rh-margin/live-readiness.json',result);console.log(json(result));
}catch(error){safeFailure(error)}
