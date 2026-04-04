/**
 * Chain & contract configuration for the rebalance agent.
 *
 * Supports Sepolia (testnet, where Calibur is deployed) and Base (mainnet).
 */

import { type Address, type Chain } from 'viem';
import { sepolia, base } from 'viem/chains';

// ---------------------------------------------------------------------------
// Chain configs
// ---------------------------------------------------------------------------

export interface ChainConfig {
  chain: Chain;
  chainId: number;
  name: string;
  rpcUrls: string[];
  contracts: {
    calibur: Address;
    poolManager: Address;
    positionManager: Address;
    universalRouter: Address;
    stateView: Address;
    quoter: Address;
    permit2: Address;
  };
  /** Known test tokens on Sepolia, or production tokens on Base */
  tokens: Record<string, TokenDef>;
}

export interface TokenDef {
  symbol: string;
  address: Address;
  decimals: number;
}

// Calibur is deployed at the same address on all chains
const CALIBUR_ADDRESS: Address = '0x000000009B1D0aF20D8C6d0A44e162d11F9b8f00';
const PERMIT2_ADDRESS: Address = '0x000000000022D473030F116dDEE9F6B43aC78BA3';

export const SEPOLIA_CONFIG: ChainConfig = {
  chain: sepolia,
  chainId: 11155111,
  name: 'Sepolia',
  rpcUrls: [
    process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com',
    'https://rpc.sepolia.org',
    'https://sepolia.drpc.org',
  ],
  contracts: {
    calibur: CALIBUR_ADDRESS,
    poolManager: '0xE03A1074c86CFeDd5C142C4F04F1a1536e203543',
    positionManager: '0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4',
    universalRouter: '0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b',
    stateView: '0xe1dd9c3fa50edb962e442f60dfbc432e24537e4c',
    quoter: '0x61b3f2011a92d183c7dbadbda940a7555ccf9227',
    permit2: PERMIT2_ADDRESS,
  },
  tokens: {
    // Uniswap's standard Sepolia test tokens — we'll discover actual ones during spike
    WETH: { symbol: 'WETH', address: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14', decimals: 18 },
    USDC: { symbol: 'USDC', address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', decimals: 6 },
  },
};

export const BASE_CONFIG: ChainConfig = {
  chain: base,
  chainId: 8453,
  name: 'Base',
  rpcUrls: [
    process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    'https://base.drpc.org',
    'https://base.publicnode.com',
  ],
  contracts: {
    calibur: CALIBUR_ADDRESS,
    poolManager: '0x498581ff718922c3f8e6a244956af099b2652b2b',
    positionManager: '0x7c5f5a4bbd8fd63184577525326123b519429bdc',
    universalRouter: '0x6ff5693b99212da76ad316178a184ab56d299b43',
    stateView: '0xa3c0c9b65bad0b08107aa264b0f3db444b867a71',
    quoter: '0x0d5e0f971ed27fbff6c2837bf31316121532048d',
    permit2: PERMIT2_ADDRESS,
  },
  tokens: {
    ETH: { symbol: 'ETH', address: '0x0000000000000000000000000000000000000000', decimals: 18 },
    USDC: { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
    USDS: { symbol: 'USDS', address: '0x820C137fa70C8691f0e44Dc420a5e53c168921Dc', decimals: 18 },
    cbBTC: { symbol: 'cbBTC', address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', decimals: 8 },
  },
};

export function getConfig(chainId?: number): ChainConfig {
  const id = chainId ?? parseInt(process.env.CHAIN_ID || '11155111');
  switch (id) {
    case 11155111: return SEPOLIA_CONFIG;
    case 8453: return BASE_CONFIG;
    default: throw new Error(`Unsupported chain ID: ${id}`);
  }
}
