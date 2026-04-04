/**
 * Uniswap Trade API Client
 *
 * Wraps the Uniswap Trade API endpoints needed for the rebalance agent:
 * - /quote          — get optimal swap route + amounts
 * - /swap_7702      — generate 7702-delegated swap calldata
 * - /wallet/encode_7702    — batch multiple txs into one 7702 delegated execution
 * - /wallet/check_delegation — verify user's delegation status
 */

const BASE_URL = 'https://trade-api.gateway.uniswap.org/v1';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QuoteRequest {
  type: 'EXACT_INPUT' | 'EXACT_OUTPUT';
  amount: string;
  tokenInChainId: number;
  tokenOutChainId: number;
  tokenIn: string;
  tokenOut: string;
  swapper: string;
  slippageTolerance?: number;
  urgency?: 'normal' | 'fast' | 'urgent';
}

export interface QuoteResponse {
  requestId: string;
  quote: {
    input: { token: string; amount: string };
    output: { token: string; amount: string };
    swapper: string;
    chainId: number;
    slippage: { tolerance: number };
    tradeType: string;
    gasFee: string;
    gasFeeUSD: string;
    route: any[];
    routeString: string;
    quoteId: string;
    [key: string]: any;
  };
  routing: string;
  permitData?: any;
}

export interface Swap7702Request {
  quote: any; // The full quote object returned from /quote
  permitData?: any;
  smartContractDelegationAddress?: string;
  includeGasInfo?: boolean;
  deadline?: number;
  simulateTransaction?: boolean;
}

export interface Swap7702Response {
  requestId: string;
  swap: {
    to: string;
    from: string;
    data: string;
    value: string;
    chainId: number;
    gasLimit?: string;
  };
  gasFee?: string;
}

export interface Encode7702Call {
  to: string;
  from: string;
  data: string;
  value: string;
  chainId: number;
}

export interface Encode7702Request {
  calls: Encode7702Call[];
  smartContractDelegationAddress: string;
  walletAddress: string;
}

export interface Encode7702Response {
  requestId: string;
  encoded: {
    to: string;
    from: string;
    data: string;
    value: string;
    chainId: number;
  };
}

export interface CheckDelegationRequest {
  walletAddresses: string[];
  chainIds: number[];
}

export interface CheckDelegationResponse {
  requestId: string;
  [key: string]: any; // delegation status per address/chain
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class UniswapApiClient {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.UNISWAP_API_KEY || '';
    if (!this.apiKey) {
      console.warn('[UniswapApiClient] No API key set — requests will likely fail with 401');
    }
  }

  private async post<T>(endpoint: string, body: unknown): Promise<T> {
    const url = `${BASE_URL}${endpoint}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Uniswap API ${endpoint} failed (${res.status}): ${text}`);
    }

    return res.json() as Promise<T>;
  }

  // ── /quote ──────────────────────────────────────────────────────────────
  async quote(params: QuoteRequest): Promise<QuoteResponse> {
    return this.post<QuoteResponse>('/quote', params);
  }

  // ── /swap ───────────────────────────────────────────────────────────────
  /** Standard swap — returns calldata targeting UniversalRouter directly. */
  async swap(params: {
    quote: any;
    signature?: string;
    permitData?: any;
    simulateTransaction?: boolean;
    deadline?: number;
  }): Promise<Swap7702Response> {
    return this.post<Swap7702Response>('/swap', params);
  }

  // ── /swap_7702 ──────────────────────────────────────────────────────────
  async swap7702(params: Swap7702Request): Promise<Swap7702Response> {
    return this.post<Swap7702Response>('/swap_7702', params);
  }

  // ── /wallet/encode_7702 ─────────────────────────────────────────────────
  async encode7702(params: Encode7702Request): Promise<Encode7702Response> {
    return this.post<Encode7702Response>('/wallet/encode_7702', params);
  }

  // ── /wallet/check_delegation ────────────────────────────────────────────
  async checkDelegation(params: CheckDelegationRequest): Promise<CheckDelegationResponse> {
    return this.post<CheckDelegationResponse>('/wallet/check_delegation', params);
  }
}
