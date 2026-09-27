import { chargedGasCost } from "./lib/rh-gas-ledger.mjs";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  context,
  artifact,
  v,
  assert,
  same,
  json,
  save,
  submit,
  safeFailure,
} from "./lib/rh-live.mjs";
import { acquireLock } from "./lib/process-lock.mjs";
import {
  marketReferenceContext,
  publishReference,
  publisherPolicy,
} from "./lib/rh-publisher.mjs";
import { acceptanceCollateralRaw } from "./lib/rh-expansion-plan.mjs";
import {
  readMarginSnapshot,
  marginOrder,
} from "../apps/web/src/lib/margin-client.ts";
let ctx,
  entry,
  long,
  margin,
  release,
  activated = false,
  completed = false;
const runId = randomUUID();
const registryAbi = artifact("LeveraMarketRegistry").abi,
  pairAbi = artifact("LeveraPair").abi,
  routerAbi = artifact("MarginRouter").abi;
async function status(value) {
  for (const d of [long, margin.short]) {
    const current = await ctx.client.readContract({
      address: d.registry,
      abi: registryAbi,
      functionName: "getMarket",
      args: [d.marketId],
    });
    if (current.status !== value)
      await submit(
        ctx,
        `expand-accept-${runId}-status-${d.marketId}-${value}`,
        ctx.deployer,
        {
          to: d.registry,
          data: v.encodeFunctionData({
            abi: registryAbi,
            functionName: "setMarketStatus",
            args: [d.marketId, value],
          }),
        },
      );
  }
  const paused = await ctx.client.readContract({
    address: margin.router,
    abi: routerAbi,
    functionName: "isPaused",
  });
  if (paused !== (value === 2))
    await submit(ctx, `expand-accept-${runId}-router-${value}`, ctx.deployer, {
      to: margin.router,
      data: v.encodeFunctionData({
        abi: routerAbi,
        functionName: "setPaused",
        args: [value === 2],
      }),
    });
}
try {
  const [profile, symbol] = process.argv.slice(2);
  assert(
    process.argv.length === 4 &&
      profile === ".env.testnet" &&
      ["AMZN", "PLTR", "NFLX", "AMD"].includes(symbol),
    "EXPLICIT_ACCEPTANCE_MARKET_REQUIRED",
  );
  release = acquireLock(".secrets/rh-live/operations.lock");
  ctx = await context(profile);
  entry = ctx.state.expansion?.[symbol];
  assert(
    entry?.deploymentComplete && entry.descriptor,
    "MARKET_DEPLOYMENT_REQUIRED",
  );
  ({ long, margin } = entry.descriptor);
  assert(
    ctx.env.RH_EXPANSION_APPROVED_SCOPE_HASH === entry.scopeHash,
    "EXPANSION_SCOPE_APPROVAL_REQUIRED",
  );
  const ref = marketReferenceContext(ctx, symbol),
    binding = JSON.parse(ref.env.RH_REFERENCE_BINDING_JSON),
    policy = publisherPolicy(ctx.env.RH_PUBLISHER_POLICY_JSON, binding);
  const plan = JSON.parse(ctx.env.RH_MARGIN_PLAN_JSON),
    execution = JSON.parse(ctx.env.RH_LIVE_EXECUTION_JSON);
  const { client, deployer } = ctx;
  const prefix = `expand-accept-v1-${symbol.toLowerCase()}`;
  const read = (address, abi, functionName, args = []) =>
    client.readContract({ address, abi, functionName, args });
  const balance = (token) =>
    read(token, v.erc20Abi, "balanceOf", [deployer.address]);
  const position = (pair) =>
    read(pair, pairAbi, "accounts", [deployer.address]);
  const call = async (stage, to, abi, functionName, args) => {
    const id = `${prefix}-${stage}`,
      data = v.encodeFunctionData({ abi, functionName, args });
    if (ctx.state.operations[id])
      return submit(ctx, id, deployer, { to, data });
    const gas =
      ((await client.estimateGas({ account: deployer.address, to, data })) *
        BigInt(margin.policy.gasBufferBps) +
        9999n) /
      10000n;
    assert(
      gas <= BigInt(margin.policy.maxGasLimit),
      "ACCEPTANCE_GAS_LIMIT_EXCEEDED",
    );
    return submit(ctx, id, deployer, { to, data, gas });
  };
  const published = async () =>
    publishReference(ref, policy.minimumFreshSeconds);
  const acceptance = (entry.acceptance ??= { direct: {}, sides: {} });
  ctx.persist();
  await readMarginSnapshot(client, margin, long, deployer.address);
  // Preserve room to close and pause even when the approved cumulative budget is nearly used.
  const reserved = Object.values(ctx.state.operations)
    .filter((x) => same(x.from, deployer.address))
    .reduce((n, x) => n + chargedGasCost(x), 0n);
  const reserve =
    4n * BigInt(margin.policy.maxGasLimit) * (await client.getGasPrice());
  assert(
    reserved + reserve < BigInt(execution.maxSignerGasCostWei),
    "ACCEPTANCE_CLEANUP_BUDGET_REQUIRED",
  );
  await published();
  activated = true;
  await status(0);
  const direct = acceptance.direct;
  if (!direct.complete) {
    if (!direct.args) {
      const account = await position(long.pair);
      assert(
        account[0] === 0n && account[1] === 0n,
        "ACCEPTANCE_REQUIRES_EMPTY_ACCOUNT",
      );
      const oracleAbi = artifact("RhTestnetReferenceOracle").abi;
      const [stockPrice, debtPrice, risk] = await Promise.all([
        read(long.oracle, oracleAbi, "getPrice", [long.collateral]),
        read(long.oracle, oracleAbi, "getPrice", [long.debt]),
        read(long.registry, registryAbi, "getMarket", [long.marketId]),
      ]);
      direct.args = {
        collateral: String(
          acceptanceCollateralRaw(
            execution.acceptanceDebtRaw,
            stockPrice,
            debtPrice,
            risk.maxLtvBps,
          ),
        ),
        debt: execution.acceptanceDebtRaw,
      };
      direct.before = {
        stock: String(await balance(long.collateral)),
        stable: String(await balance(long.debt)),
      };
      ctx.persist();
    }
    const c = BigInt(direct.args.collateral),
      d = BigInt(direct.args.debt);
    await call(
      "direct-stock-approval",
      long.collateral,
      v.erc20Abi,
      "approve",
      [long.pair, c],
    );
    const deposit = await call(
      "direct-deposit",
      long.pair,
      pairAbi,
      "depositCollateral",
      [c],
    );
    await published();
    const borrow = await call("direct-borrow", long.pair, pairAbi, "borrow", [
      d,
    ]);
    await call("direct-repay-approval", long.debt, v.erc20Abi, "approve", [
      long.pair,
      d,
    ]);
    const repay = await call("direct-repay", long.pair, pairAbi, "repay", [d]);
    const withdraw = await call(
      "direct-withdraw",
      long.pair,
      pairAbi,
      "withdrawCollateral",
      [c],
    );
    const account = await position(long.pair);
    assert(account[0] === 0n && account[1] === 0n, "DIRECT_POSITION_NOT_EMPTY");
    assert(
      (await balance(long.collateral)) === BigInt(direct.before.stock) &&
        (await balance(long.debt)) === BigInt(direct.before.stable),
      "DIRECT_BALANCE_MISMATCH",
    );
    direct.result = {
      depositHash: deposit.transactionHash,
      borrowHash: borrow.transactionHash,
      repayHash: repay.transactionHash,
      withdrawHash: withdraw.transactionHash,
      collateralRaw: String(c),
      debtRaw: String(d),
      finalCollateral: "0",
      finalDebt: "0",
    };
    direct.complete = true;
    ctx.persist();
    console.log(json({ symbol, directLendingPassed: true }));
  }
  for (const isShort of [false, true])
    for (const multipleBps of isShort
      ? margin.policy.shortExposureBps
      : margin.policy.longLeveragesBps) {
      const side = isShort ? "short" : "long",
        key = `${side}-${multipleBps}`,
        pair = isShort ? margin.short.pair : long.pair;
      const s = (acceptance.sides[key] ??= {});
      if (s.complete) continue;
      await published();
      if (!s.before) {
        const p = await position(pair);
        assert(p[0] === 0n && p[1] === 0n, "ACCEPTANCE_REQUIRES_EMPTY_ACCOUNT");
        s.before = {
          stock: String(await balance(long.collateral)),
          stable: String(await balance(long.debt)),
        };
        ctx.persist();
      }
      if (!ctx.state.operations[`${prefix}-${key}-open`]) {
        const snapshot = await readMarginSnapshot(
          client,
          margin,
          long,
          deployer.address,
        );
        const order = marginOrder(
          margin,
          long,
          snapshot,
          isShort,
          v.formatUnits(BigInt(plan.acceptanceMarginRaw), 6),
          multipleBps,
        );
        s.openArgs = [
          isShort,
          String(order.margin),
          String(order.debt),
          String(order.minCollateral),
          String(
            (await client.getBlock()).timestamp +
              BigInt(margin.policy.deadlineSeconds),
          ),
        ];
        ctx.persist();
      }
      await call(`${key}-approve`, long.debt, v.erc20Abi, "approve", [
        margin.router,
        BigInt(plan.acceptanceMarginRaw),
      ]);
      await call(`${key}-operator`, pair, pairAbi, "setOperator", [
        margin.router,
        true,
      ]);
      const open = await call(
        `${key}-open`,
        margin.router,
        routerAbi,
        "open",
        s.openArgs.map((x, i) => (i === 0 ? x : BigInt(x))),
      );
      const event = (receipt, name) => {
        const events = receipt.logs
          .filter((x) => same(x.address, margin.router))
          .flatMap((log) => {
            try {
              const e = v.decodeEventLog({
                abi: routerAbi,
                data: log.data,
                topics: log.topics,
              });
              return e.eventName === name ? [e.args] : [];
            } catch {
              return [];
            }
          });
        assert(
          events.length === 1 &&
            same(events[0].user, deployer.address) &&
            events[0].isShort === isShort,
          "MARGIN_EVENT_MISMATCH",
        );
        return events[0];
      };
      const opened = event(open, "PositionOpened");
      const atOpen = await client.readContract({
        address: pair,
        abi: pairAbi,
        functionName: "accounts",
        args: [deployer.address],
        blockNumber: open.blockNumber,
      });
      assert(
        atOpen[0] === opened.collateral && atOpen[1] === opened.debt,
        "OPEN_POSITION_MISMATCH",
      );
      if (!ctx.state.operations[`${prefix}-${key}-close`]) {
        const quote = await read(margin.router, routerAbi, "quoteClose", [
          isShort,
          deployer.address,
        ]);
        s.closeArgs = [
          isShort,
          String((quote * BigInt(10000 - margin.policy.slippageBps)) / 10000n),
          String(
            (await client.getBlock()).timestamp +
              BigInt(margin.policy.deadlineSeconds),
          ),
        ];
        ctx.persist();
      }
      const close = await call(
        `${key}-close`,
        margin.router,
        routerAbi,
        "close",
        s.closeArgs.map((x, i) => (i === 0 ? x : BigInt(x))),
      );
      const closed = event(close, "PositionClosed"),
        after = await position(pair);
      assert(after[0] === 0n && after[1] === 0n, "POSITION_NOT_CLOSED");
      for (const token of [long.collateral, long.debt]) {
        assert(
          (await read(token, v.erc20Abi, "balanceOf", [margin.router])) === 0n,
          "ROUTER_DUST",
        );
        for (const target of [long.pair, margin.short.pair])
          assert(
            (await read(token, v.erc20Abi, "allowance", [
              margin.router,
              target,
            ])) === 0n,
            "ROUTER_ALLOWANCE",
          );
      }
      assert(
        (await balance(long.collateral)) === BigInt(s.before.stock),
        "USER_STOCK_BALANCE_CHANGED",
      );
      assert(
        (await balance(long.debt)) ===
          BigInt(s.before.stable) -
            BigInt(plan.acceptanceMarginRaw) +
            closed.stableReturned,
        "USER_STABLE_BALANCE_MISMATCH",
      );
      await call(`${key}-revoke`, pair, pairAbi, "setOperator", [
        margin.router,
        false,
      ]);
      s.result = {
        side,
        multipleBps,
        openHash: open.transactionHash,
        openBlock: open.blockNumber,
        closeHash: close.transactionHash,
        closeBlock: close.blockNumber,
        opened,
        closed,
        finalCollateral: "0",
        finalDebt: "0",
        routerDust: "0",
        stableCostRaw: BigInt(plan.acceptanceMarginRaw) - closed.stableReturned,
      };
      s.complete = true;
      ctx.persist();
      console.log(
        json({
          symbol,
          side,
          multipleBps,
          openHash: open.transactionHash,
          closeHash: close.transactionHash,
          passed: true,
        }),
      );
    }
  completed = true;
} catch (error) {
  safeFailure(error);
} finally {
  if (ctx && activated)
    try {
      await status(2);
      if (completed) {
        entry.liveAcceptancePassed = true;
        entry.acceptance.complete = true;
        ctx.persist();
        mkdirSync("docs/evidence/rh-expansion-live", { recursive: true });
        save(
          `docs/evidence/rh-expansion-live/${long.collateralSymbol.toLowerCase()}-acceptance.json`,
          {
            capturedAt: new Date().toISOString(),
            chainId: 46630,
            symbol: long.collateralSymbol,
            method:
              "Signed real testnet transactions with canonical receipt, event, account, balance and allowance checks; browser signing is not claimed.",
            direct: entry.acceptance.direct.result,
            sides: Object.values(entry.acceptance.sides).map((x) => x.result),
            liveAcceptancePassed: true,
            finalState: "PAUSED",
            applicationEnabled: false,
          },
        );
      }
    } catch (error) {
      safeFailure(error);
    }
  release?.();
}
