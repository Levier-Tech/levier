import { http, createConfig } from 'wagmi';
import { defineChain } from 'viem';
import { injected } from 'wagmi/connectors/injected';
import { env } from '../env.mjs';

const rpcEndpoint = '/api/rpc';

export const protocolChain = defineChain({
  id: Number(env.CHAIN_ID),
  name: env.CHAIN_NAME,
  nativeCurrency: {
    name: env.NATIVE_CURRENCY_NAME,
    symbol: env.NATIVE_CURRENCY_SYMBOL,
    decimals: env.NATIVE_CURRENCY_DECIMALS,
  },
  rpcUrls: {
    default: {
      http: [rpcEndpoint],
    },
    public: {
      http: [rpcEndpoint],
    },
  },
  blockExplorers: {
    default: {
      name: `${env.CHAIN_NAME} Explorer`,
      url: env.EXPLORER_URL,
    },
  },
  testnet: env.NETWORK_MODE === 'TESTNET',
});

export const wagmiConfig = createConfig({
  chains: [protocolChain],
  connectors: [
    injected({
      target() {
        return {
          id: 'injected',
          name: 'Browser Wallet',
          provider: typeof window !== 'undefined' ? (window as any).ethereum : undefined,
        };
      },
    }),
  ],
  transports: {
    [protocolChain.id]: http(rpcEndpoint),
  },
  ssr: true,
});

