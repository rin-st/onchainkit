import { baseSepolia } from 'viem/chains';
import type { OnchainKitConfig, SetOnchainKitConfig } from './types';

// The ONCHAIN_KIT_CONFIG is not exported at index.ts,
// but only acccessed through the get and set functions.
export const ONCHAIN_KIT_CONFIG: OnchainKitConfig = {
  address: null,
  apiKey: null,
  capabilities: {
    paymaster: false,
    batching: false,
    funding: false,
  },
  chain: baseSepolia,
  rpcUrl: null,
  schemaId: null,
};

/**
 * Access the ONCHAIN_KIT_CONFIG object directly by providing the key.
 * This is powerful when you use OnchainKit utilities outside of the React context.
 */
export const getOnchainKitConfig = <K extends keyof typeof ONCHAIN_KIT_CONFIG>(
  configName: K,
): (typeof ONCHAIN_KIT_CONFIG)[K] => {
  return ONCHAIN_KIT_CONFIG[configName];
};

/**
 * Update the ONCHAIN_KIT_CONFIG object directly by providing the properties to update.
 * This is powerful when you use OnchainKit utilities outside of the React context.
 */
export const setOnchainKitConfig = (properties: SetOnchainKitConfig) => {
  Object.assign(ONCHAIN_KIT_CONFIG, properties);
  return getOnchainKitConfig;
};
