# ALMA — Autonomous Liquidity Management Agent

> Concentrated liquidity on autopilot — powered by the Uniswap Trading API and Calibur (EIP-7702).

## The Problem

Concentrated liquidity (CL) on Uniswap V4 offers superior capital efficiency, but it comes with a cost: positions go out of range. When that happens, LPs earn zero fees while their capital sits idle. Most LPs are passive, they don't monitor positions 24/7, and manually rebalancing means signing multiple transactions, timing swaps, and choosing new ranges.

The result: Over 40% of CL positions sit out of range at any given time, which represents hundreds of millions in idle liquidity earning zero fees. This also explains why half of all LPs would have been better off just holding.

## The Solution

ALMA is an autonomous agent that monitors your Uniswap V4 positions and rebalances them when they drift out of range, **without requiring your signature for every transaction**.

Here's how:

1. **You connect your wallet** — your EOA must be delegated to [Calibur](https://github.com/Uniswap/calibur) via EIP-7702 (the Uniswap Wallet with Smart Wallet enabled does this automatically)
2. **You sign once** — an EIP-712 typed data signature (no transaction) that registers ALMA's key, configures the on-chain whitelist (GuardedExecutorHook), and sets a time-limited expiry. ALMA's backend relayer submits this on-chain for you.
3. **ALMA watches and acts** — the agent monitors your positions, and when one goes out of range, it autonomously executes: **burn → swap → mint** in a new optimal range via signed batched calls

You stay in control. ALMA can only do what you've explicitly allowed.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      User's EOA                         │
│              (delegated to Calibur via 7702)            │
│                                                         │
│  ┌─────────────────┐    ┌────────────────────────────┐  │
│  │  Registered Key │───▶│   GuardedExecutorHook      │  │
│  │  (ALMA agent)   │    │   (selector whitelist +    │  │
│  │  30-day expiry  │    │    on-chain enforcement)   │  │
│  └─────────────────┘    └────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
            │
            │ SignedBatchedCall (EIP-712)
            ▼
┌─────────────────────────────────────────────────────────┐
│                   ALMA Backend                          │
│                                                         │
│  API Server (Express)                                   │
│  ├── POST /api/delegate    — relay user's signed setup  │
│  ├── POST /api/rebalance   — trigger manual rebalance   │
│  ├── GET  /api/actions     — activity history           │
│  └── GET  /api/stats       — per-user stats             │
│                                                         │
│  Position Monitor                                       │
│  ├── Discover positions via PositionManager events      │
│  ├── Check tick vs range on each poll cycle             │
│  └── Trigger rebalance when out of range                │
│                                                         │
│  Rebalancer                                             │
│  ├── Burn (PositionManager.modifyLiquidities)           │
│  ├── Swap (Uniswap Trading API → UniversalRouter)       │
│  └── Mint (PositionManager.modifyLiquidities)           │
└─────────────────────────────────────────────────────────┘
```

### The Rebalance Flow

1. **Monitor** — Discover positions via `PositionManager` transfer events, read pool tick and position range via `StateView`
2. **Evaluate** — Is the position out of range? By how much? Worth rebalancing given gas costs?
3. **Plan** — Compute burn amounts, query the **Uniswap Trading API** for optimal swap routing (`/quote` finds the best route and expected output, `/swap` generates the exact UniversalRouter calldata), calculate new tick range centered on current tick, build mint params
4. **Sign** — Construct a `SignedBatchedCall` (EIP-712) with all calls: burn → approve → permit2 → swap → approve → permit2 → mint. The swap calldata from the Trading API is embedded directly into the batch.
5. **Submit** — Send the batch to the user's Calibur-delegated EOA. Calibur validates the agent's signature, the GuardedExecutorHook enforces the selector whitelist, and the calls execute as the user

The **Uniswap Trading API** is central to this flow since it handles all swap routing and calldata generation, so the agent never needs to implement its own routing logic. The API returns production-grade UniversalRouter calldata with optimal routes across Uniswap pools, which the agent wraps into a single atomic Calibur batch alongside the burn and mint operations.

## Security Model

Three layers of protection ensure the agent can only do what it should:

| Layer | What it blocks | How |
|-------|---------------|-----|
| **GuardedExecutorHook** | Direct theft (transfers, unauthorized approvals) | On-chain selector whitelist: only `modifyLiquidities`, `UniversalRouter.execute`, and `approve` → Permit2 are allowed |
| **Key expiry** | Long-term key compromise | Agent keys expire after 30 days via Calibur's native settings. Users can revoke at any time |
| **Agent-side validation** | Bad pools, bad swap prices, bugs | Before signing, the agent validates every call against a whitelist of allowed targets/selectors and pool IDs |
| **Slippage protection** | Value extraction via manipulated swaps | Minimum output amounts enforced in swap calldata |

Even with a compromised agent key, an attacker **cannot**: transfer tokens directly, or call any contract/function outside the whitelist. The key expires after 30 days and can be revoked by the user at any time.

> **Hackathon caveat:** The current GuardedExecutorHook does not restrict ETH `value` attached to calls (see [Future Work](#future-work)), and the agent-side call validator is a stub that allows all calls. These are known limitations to be hardened before production use.

## Uniswap Stack Integration

ALMA is built entirely on the Uniswap stack:

| Component | Usage |
|-----------|-------|
| **Uniswap Trading API** | Core of the rebalance flow: `/quote` finds optimal swap routes across all Uniswap pools, `/swap` generates production-grade UniversalRouter calldata that the agent embeds directly into Calibur batched calls |
| **Calibur** | EIP-7702 delegation framework: enables agent-signed batched execution as the user |
| **GuardedExecutorHook** | Calibur execution hook: on-chain enforcement of agent permissions |
| **PositionManager** | V4 position lifecycle: `modifyLiquidities` for burn and mint |
| **StateView** | Read pool state (`getSlot0`, `getLiquidity`) for position monitoring |
| **UniversalRouter** | Swap execution target (called via Trading API-generated calldata) |
| **Permit2** | Token approval flow for position minting |
| **V4 SDK** | TypeScript calldata encoding for burn/mint planner actions |

## Deployed Contracts

| Contract | Chain | Address |
|----------|-------|---------|
| GuardedExecutorHook | Base | [`0x033Be604929CbD65Fb67880741aB2b8292E46dC8`](https://basescan.org/address/0x033Be604929CbD65Fb67880741aB2b8292E46dC8) |
| Calibur (Uniswap) | Base | [`0x000000009B1D0aF20D8C6d0A44e162d11F9b8f00`](https://basescan.org/address/0x000000009B1D0aF20D8C6d0A44e162d11F9b8f00) |

## Project Structure

```
alma/
├── contracts/    # Foundry — GuardedExecutorHook deployment script
├── backend/      # Express + TypeScript — API server, position monitoring, auto-rebalancing (Upstash Redis)
└── frontend/     # Next.js — delegation stepper, position dashboard, wallet connect
```

## Try It Live

You can try **[ALMA](https://frontend-iota-six-kvvad292ak.vercel.app/)** on our deployed version without any local setup.

Connect your wallet, delegate to ALMA, and let it manage your Uniswap V4 positions on Base.

## Local Setup

### Prerequisites
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (for contracts)
- Node.js 18+ (for backend and frontend)
- A Uniswap API key from the [Developer Platform](https://developers.uniswap.org/dashboard/)
- An [Upstash Redis](https://upstash.com/) instance (for backend persistence)

### Contracts
```bash
cd contracts
forge build
```

### Backend
```bash
cd backend
pnpm install
cp .env.example .env   # fill in AGENT_PRIVATE_KEY, UNISWAP_API_KEY, Upstash credentials
pnpm run server        # starts on http://localhost:3001
```

### Frontend
```bash
cd frontend
pnpm install
pnpm run dev           # starts on http://localhost:3000
```

## On-Chain Proof

**EIP-7702 Delegation:**
- [`0x3512212f...`](https://basescan.org/tx/0x3512212fe4a322714ed18c32fcb05ab98a8533e20b6134732be42cc355551d20) — User delegates to Calibur, registers ALMA agent key, configures GuardedExecutorHook whitelist

**Autonomous Rebalances:**
- [`0xb8ac1fdb...`](https://basescan.org/tx/0xb8ac1fdbba841d5b9c84daa906eca092f34b2da2000498e8e16ba51b26416540) — Burn → swap → mint in a single atomic batch
- [`0x9fe2eba5...`](https://basescan.org/tx/0x9fe2eba5045228deedb688b126c344dbbbd8a4eb1214b4e9ff2d7f084e71ab17) — Burn → swap → mint in a single atomic batch
- [`0x87a4aacd...`](https://basescan.org/tx/0x87a4aacd7c92ecf5d2b7c8878c08ca4a71e1d0e011f1d30a4e93c019f1114431) — Burn → swap → mint in a single atomic batch

## Future Work

ALMA was built in a hackathon sprint. Here's what a production-grade version would address:

### Security Hardening

- **ETH value restriction in the hook** — The current `GuardedExecutorHook` does not check the `value` field on calls (there's a `// TODO: check value` in the contract). A custom hook should enforce `value == 0` for all agent-initiated calls, or whitelist specific value amounts per target, to prevent ETH drainage.
- **Calldata argument validation** — The hook enforces (target, selector) pairs but does not inspect calldata arguments. This means `approve(spender, amount)` passes the hook regardless of which `spender` is provided. A production hook should restrict approve targets to only Permit2 and UniversalRouter.
- **Pool whitelisting** — The agent can currently construct `modifyLiquidities` or swap calls targeting any pool. A production hook or agent-side validator should enforce a user-configured whitelist of allowed pool IDs to prevent interaction with malicious or low-liquidity pools.
- **Agent-side call validator** — The current `call-validator.ts` is a stub that allows all calls. In production, this should validate every call in the batch against the on-chain whitelist, check pool IDs, verify swap output amounts against oracle prices, and reject suspicious transactions before signing.

### Smarter Concentration Strategies

- **Per-pool-type range widths** — The current rebalancer uses a fixed `widthMultiplier` (default 10× tickSpacing) for all pools. Stable pairs (e.g., USDC/USDS) should use much tighter ranges, while volatile pairs (e.g., ETH/BTC) need wider ranges to avoid excessive rebalancing.
- **Volatility-aware ranges** — Use historical volatility or on-chain TWAP data to dynamically size ranges. In high-volatility regimes, widen ranges to reduce rebalance frequency; in low-volatility regimes, tighten ranges for maximum fee capture.
- **User-configurable risk profiles** — Let users choose between aggressive (tight range, more rebalances, higher fees but more IL) and conservative (wide range, fewer rebalances, lower fees but less IL) strategies, with the agent adapting its range calculation accordingly.
- **Rebalance cost optimization** — Factor in gas costs and expected fee revenue to decide whether a rebalance is worth executing. Skip rebalances where the expected fee improvement doesn't justify the gas + swap costs.

### Broader Protocol Support

- ALMA currently **only supports Uniswap V4** positions. Extending to **Uniswap V3** would significantly expand the addressable market, though V3's different position NFT model and lack of native batched calls would require a separate calldata path.
- Support for other concentrated liquidity DEXs (Aerodrome, PancakeSwap V3, etc.) could be added with protocol-specific adapters.

### Additional Features

- **Multi-chain support** — Expand beyond Base to other chains where Uniswap V4 is deployed.
- **Position analytics** — Track fee APR, impermanent loss, and rebalance P&L over time to help users evaluate strategy performance.
- **Alerting** — Notify users via Telegram/email when positions go out of range, when rebalances execute, or when the agent key is nearing expiry.

## Team

Built at ETHGlobal Cannes 2026 by Carl & Yanis.

**Carl Schmidt** — Business & Product. B.A. Economics & Computer Science (University of Zurich). 7+ years in crypto across product, content, and strategy. Designed early product material for Balancer, published commissioned articles on Starknet, and supported go-to-market for deBridge's Solana expansion.

**Yanis Berkani** — Engineering & Security. B.Sc. Computer Science (EPF Lausanne), M.Sc. Cyber Security (ETH Zurich). 5+ years in DeFi. Lead Smart Contract Developer at Spectra for 3 years, where he built the first permissionless yield derivatives protocol and scaled it to $250M TVL.

## License

MIT
