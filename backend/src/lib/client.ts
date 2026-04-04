/**
 * Viem client factory for the agent service.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  fallback,
  type PublicClient,
  type WalletClient,
  type Account,
  type Transport,
  type Chain,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { type ChainConfig } from './config.js';

const clientCache = new Map<number, PublicClient>();

/** Cached read-only public client for a given chain config. */
export function getPublicClient(config: ChainConfig): PublicClient {
  const cached = clientCache.get(config.chainId);
  if (cached) return cached;

  const transport = fallback(
    config.rpcUrls.map((url) => http(url, { timeout: 15_000 }))
  );

  const client = createPublicClient({
    chain: config.chain,
    transport,
    batch: { multicall: true },
  });

  clientCache.set(config.chainId, client);
  return client;
}

/** Create a wallet client from a private key (agent hot wallet). */
export function getWalletClient(
  config: ChainConfig,
  privateKey: `0x${string}`
): { walletClient: WalletClient; account: Account } {
  const account = privateKeyToAccount(privateKey);

  const transport = fallback(
    config.rpcUrls.map((url) => http(url, { timeout: 15_000 }))
  );

  const walletClient = createWalletClient({
    chain: config.chain,
    transport,
    account,
  });

  return { walletClient, account };
}
