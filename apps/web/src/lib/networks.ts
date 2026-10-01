// Robinhood Chain networks the app can run against. Deployment descriptors must carry one of
// these chain IDs, and every on-chain read still checks the connected chain matches it.
export const NETWORK_CHAIN_IDS = { TESTNET: 46630, MAINNET: 4663 } as const;
export type SupportedChainId =
    (typeof NETWORK_CHAIN_IDS)[keyof typeof NETWORK_CHAIN_IDS];
export const isSupportedChainId = (id: number): id is SupportedChainId =>
    Object.values(NETWORK_CHAIN_IDS).includes(id as SupportedChainId);
