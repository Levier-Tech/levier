import { env } from "../env.mjs";
import type { LendingDeployment } from "./lending-client";
import type { MarginDeployment } from "./margin-client";
export type MarketDeployment = {
  symbol: string;
  enabled: boolean;
  long: LendingDeployment;
  margin: MarginDeployment;
};
export const marketDeployments =
  env.MARKET_DEPLOYMENTS_JSON as MarketDeployment[];
