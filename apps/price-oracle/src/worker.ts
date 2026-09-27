import { loadOracleConfig } from "./config.js";
import {
  fetchReference,
  tokenValuation,
  QuoteError,
} from "./services/robinhoodQuoteService.js";

/** Read-only source verification. No database client, signer, or publishing path. */
export class PriceOracleWorker {
  private isRunning = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private wake: (() => void) | undefined;
  constructor(private readonly config = loadOracleConfig()) {}

  public async observeOnce() {
    const policy = {
      maxAgeMs: this.config.ORACLE_MAX_QUOTE_AGE_MS,
      maxFutureSkewMs: this.config.ORACLE_MAX_FUTURE_SKEW_MS,
      maxSpreadBps: this.config.ORACLE_MAX_SPREAD_BPS,
    };
    const observations = [];
    for (const symbol of this.config.ORACLE_SYMBOLS_JSON) {
      try {
        const reference = await fetchReference(
          this.config.ROBINHOOD_STOCK_API_URL,
          {
            symbol,
            chainId: this.config.CHAIN_ID,
            address: this.config.PROTOCOL_ADDRESSES.tokens[symbol],
          },
          policy,
          {
            timeoutMs: this.config.ORACLE_HTTP_TIMEOUT_MS,
            maxResponseBytes: this.config.ORACLE_MAX_RESPONSE_BYTES,
            robinhoodTransport: this.config.ROBINHOOD_TRANSPORT_JSON,
          },
        );
        let valuation = null;
        let rejection = null;
        try {
          valuation = tokenValuation(reference, policy, Date.now());
        } catch (error) {
          rejection =
            error instanceof QuoteError ? error.code : "VALIDATION_UNAVAILABLE";
        }
        observations.push({ reference, valuation, rejection });
      } catch (error) {
        observations.push({
          symbol,
          rejection:
            error instanceof QuoteError ? error.code : "VALIDATION_UNAVAILABLE",
        });
      }
    }
    return {
      capturedAt: new Date().toISOString(),
      network: this.config.NETWORK_MODE,
      chainId: this.config.CHAIN_ID,
      mode: "OBSERVE",
      observations,
      databaseWrites: 0,
      transactionsSubmitted: 0,
      testnetReady: false,
    };
  }

  public async start() {
    if (this.config.ORACLE_WORKER_MODE === "DISABLED") {
      console.log(
        "[PriceOracleWorker] Disabled; no price reads or writes performed.",
      );
      return;
    }
    this.isRunning = true;
    while (this.isRunning) {
      console.log(JSON.stringify(await this.observeOnce()));
      if (this.isRunning)
        await new Promise<void>((resolve) => {
          this.wake = resolve;
          this.timer = setTimeout(resolve, this.config.ORACLE_POLL_INTERVAL_MS);
        });
    }
  }
  public stop() {
    this.isRunning = false;
    clearTimeout(this.timer);
    this.wake?.();
  }
}
