import type { Address } from "viem";
import type { NetworkMode } from "@levier/types";
import { env } from "../env.mjs";
export interface ProtocolAddresses {
  usdg: Address;
  oracle: Address;
  registry: Address;
  levierRouter: Address;
  leverageRouter: Address;
  shortRouter: Address;
  autoProtect: Address;
  levierVault: Address;
  tokens: Record<string, Address>;
  pairs: Record<string, Address>;
}
export function getAddresses(network: NetworkMode): ProtocolAddresses {
  if (network !== env.NETWORK_MODE)
    throw new Error("Network does not match the active deployment");
  return env.PROTOCOL_ADDRESSES as ProtocolAddresses;
}
