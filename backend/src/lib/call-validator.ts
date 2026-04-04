/**
 * Call Validator — stub for hackathon demo.
 * In production, validates calls against a whitelist before signing.
 */

import type { Address } from 'viem';
import type { ChainConfig } from './config.js';

export interface AllowedCall {
  to: Address;
  selector?: string;
}

export interface PoolWhitelist {
  validate: (poolKey: any, label: string) => { valid: boolean; reason: string };
}

export function buildWhitelist(_config: ChainConfig, _extraTokens?: Address[]): AllowedCall[] {
  return []; // No restrictions for hackathon demo
}

export function validateCalls(_calls: any[], _whitelist: AllowedCall[], _config: ChainConfig) {
  return { valid: true, reason: '' }; // Allow all for demo
}
