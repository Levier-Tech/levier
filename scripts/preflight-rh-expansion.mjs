import { chargedGasCost } from "./lib/rh-gas-ledger.mjs";
import { parseReferenceTransport } from "../apps/price-oracle/src/services/referenceTransport.ts";
import { parseRobinhoodTransport } from "../apps/price-oracle/src/services/robinhoodTransport.ts";
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {readMarketScope} from './lib/rh-market-scope.mjs';
import {v,verifyBinding} from './lib/rh-live.mjs';
import {fetchTestnetReport} from '../apps/price-oracle/src/services/testnetReference.ts';
const {z}=createRequire(new URL('../apps/web/package.json',import.meta.url))('zod');
const amount=z.string().regex(/^[1-9]\d*$/);
const planSchema=z.object({version:z.literal(1),chainId:z.literal(46630),assets:z.array(z.object({symbol:z.string(),seedStableRaw:amount,longLiquidityRaw:amount,shortLiquidityRaw:amount,maxSeedStockRaw:amount}).strict()).min(1).max(5)}).strict();
try{
 const [profile,directory]=process.argv.slice(2);if(profile!=='.env.testnet'||!directory)throw Error();
 const env=parseEnv(readFileSync(profile,'utf8')),scope=readMarketScope(env),plan=planSchema.parse(JSON.parse(env.RH_MARKET_EXPANSION_PLAN_JSON));
 const expected=scope.filter(x=>!x.long&&!x.margin).map(x=>x.symbol).sort();
 if(JSON.stringify(plan.assets.map(x=>x.symbol).sort())!==JSON.stringify(expected))throw Error();
 const timeout=Number(env.RPC_TIMEOUT_MS),maxAge=Number(env.ANALYTICS_MAX_BLOCK_AGE_SECONDS);
 if(!Number.isSafeInteger(timeout)||timeout<1||!Number.isSafeInteger(maxAge)||maxAge<1)throw Error();
 const client=v.createPublicClient({transport:v.http(env.RPC_URL,{timeout,retryCount:0}),cacheTime:0});
 if(await client.getChainId()!==plan.chainId)throw Error();
 const blockNumber=await client.getBlockNumber(),block=await client.getBlock({blockNumber});
 const age=()=>Math.floor(Date.now()/1000)-Number(block.timestamp);
 if(!block.hash||age()<0||age()>maxAge)throw Error();
 if(env.USDG_ADDRESS.toLowerCase()!==env.USDG_ISSUER_TESTNET_ADDRESS.toLowerCase())throw Error();
 const [stableDecimals,stableSymbol,stableRaw,gasRaw]=await Promise.all([
  client.readContract({address:env.USDG_ADDRESS,abi:v.erc20Abi,functionName:'decimals',blockNumber}),
  client.readContract({address:env.USDG_ADDRESS,abi:v.erc20Abi,functionName:'symbol',blockNumber}),
  client.readContract({address:env.USDG_ADDRESS,abi:v.erc20Abi,functionName:'balanceOf',args:[env.DEPLOYER_ADDRESS],blockNumber}),
  client.getBalance({address:env.DEPLOYER_ADDRESS,blockNumber})
 ]);
 if(stableDecimals!==6||stableSymbol!=='USDG')throw Error();
 const metadataAbi=v.parseAbi(['function uid() view returns(bytes32)','function uiMultiplier() view returns(uint256)']);
 const markets=[];
 for(const p of plan.assets){
  const row=scope.find(x=>x.symbol===p.symbol);let tokenMetadata=null;let priceBindingVerified=false;
  if(row.token)try{
   const [symbol,decimals,uid,multiplier,balance,code]=await Promise.all([
    client.readContract({address:row.token,abi:v.erc20Abi,functionName:'symbol',blockNumber}),
    client.readContract({address:row.token,abi:v.erc20Abi,functionName:'decimals',blockNumber}),
    client.readContract({address:row.token,abi:metadataAbi,functionName:'uid',blockNumber}),
    client.readContract({address:row.token,abi:metadataAbi,functionName:'uiMultiplier',blockNumber}),
    client.readContract({address:row.token,abi:v.erc20Abi,functionName:'balanceOf',args:[env.DEPLOYER_ADDRESS],blockNumber}),
    client.getCode({address:row.token,blockNumber})
   ]);
   if(symbol!==p.symbol||decimals!==18||!code||code==='0x'||multiplier<=0n)throw Error();
   tokenMetadata={uid,multiplier18:String(multiplier),runtimeCodeHash:v.keccak256(code),deployerBalance:v.formatUnits(balance,decimals),stockBudgetCovered:balance>=BigInt(p.maxSeedStockRaw)+BigInt(p.shortLiquidityRaw)};
  }catch{/* Metadata must be known before associating an external price. */}
  if(row.referenceBindingConfigured)try{
   const binding=JSON.parse(env[`RH_${p.symbol}_REFERENCE_BINDING_JSON`]);
   if(binding.stockSymbol!==p.symbol)throw Error();
   await verifyBinding({client,env},binding);
   await fetchTestnetReport(binding,{timeoutMs:Number(env.ORACLE_HTTP_TIMEOUT_MS),maxResponseBytes:Number(env.ORACLE_MAX_RESPONSE_BYTES), robinhoodTransport: parseRobinhoodTransport(env.ROBINHOOD_TRANSPORT_JSON), usdgTransport: parseReferenceTransport(env.USDG_TRANSPORT_JSON),});priceBindingVerified=true;
  }catch{/* TLS, freshness, identity and multiplier checks remain mandatory. */}
  markets.push({symbol:p.symbol,tokenMetadata,priceBindingVerified,plannedFunding:p,contractsRequired:['referenceOracle','longPair','shortReferenceOracle','shortPair','v2Pool','marginRouter'],deploymentAccepted:false});
 }
 const required=plan.assets.reduce((n,p)=>n+BigInt(p.seedStableRaw)+BigInt(p.longLiquidityRaw),0n);
 const state=JSON.parse(readFileSync('.secrets/rh-live/state.json','utf8')),policy=JSON.parse(env.RH_LIVE_EXECUTION_JSON);
 const reserved=Object.values(state.operations).filter(o=>o.from.toLowerCase()===env.DEPLOYER_ADDRESS.toLowerCase()).reduce((n,o)=>n+chargedGasCost(o),0n);
 if((await client.getBlock({blockNumber})).hash!==block.hash||age()<0||age()>maxAge)throw Error();
 const report={capturedAt:new Date().toISOString(),chainId:plan.chainId,block:String(blockNumber),markets,stableFunding:{requiredUsdg:v.formatUnits(required,6),availableUsdg:v.formatUnits(stableRaw,6),shortfallUsdg:v.formatUnits(required>stableRaw?required-stableRaw:0n,6)},gas:{walletEth:v.formatEther(gasRaw),existingBudgetRemainingEth:v.formatEther(BigInt(policy.maxSignerGasCostWei)-reserved),additionalDeploymentEstimateRequired:true},transactionsSubmitted:0,readyToDeploy:false,note:'Reviewable preparation only. Exact stock seeding needs fresh verified stock/USDG prices. Four-market deployment orchestration, gas estimate, live source binding, funding and acceptance remain mandatory. Registry/factory reuse requires fresh identity checks. This report does not enable execution.'};
 mkdirSync(directory,{recursive:true});const text=JSON.stringify(report,null,2)+'\n';writeFileSync(resolve(directory,'preflight.json'),text,{flag:'wx'});console.log(text);
}catch{console.error('Expansion preflight unavailable; check required market plan and testnet configuration. Values redacted.');process.exitCode=1;}
