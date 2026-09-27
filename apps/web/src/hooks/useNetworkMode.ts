"use client";
import type { NetworkMode } from "@levier/types";
import { env } from "../env.mjs";
// Network selection is a deployment setting, never an independent localStorage override.
export function useNetworkMode() {
  return {
    networkMode: env.NETWORK_MODE as NetworkMode,
    isTestnet: env.NETWORK_MODE === "TESTNET",
    setNetworkMode(mode: NetworkMode) {
      if (mode !== env.NETWORK_MODE)
        throw new Error(
          "Deploy a reviewed network profile before switching networks",
        );
    },
  };
}
