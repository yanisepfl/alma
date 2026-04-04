# ALMA — Autonomous Liquidity Management Agent

> Concentrated liquidity on autopilot — powered by the Uniswap Trading API and Calibur (EIP-7702).

## The Problem

Concentrated liquidity (CL) on Uniswap V4 offers superior capital efficiency, but it comes with a cost: positions go out of range. When that happens, LPs earn zero fees while their capital sits idle. Most LPs are passive, they don't monitor positions 24/7, and manually rebalancing means signing multiple transactions, timing swaps, and choosing new ranges.

The result: Over 40% of CL positions sit out of range at any given time, which represents hundreds of millions in idle liquidity earning zero fees. This also explains why half of all LPs would have been better off just holding.

## The Solution

ALMA is an autonomous agent that monitors your Uniswap V4 positions and rebalances them when they drift out of range, **without requiring your signature for every transaction**.

Here's how:

1. **You delegate once** — sign a single EIP-7702 authorization that sets your EOA to use [Calibur](https://github.com/Uniswap/calibur), Uniswap's delegation framework
2. **You register ALMA's key** — authorize the agent to act on your behalf, with scoped permissions and a time-limited key
3. **ALMA watches and acts** — the agent monitors your positions, and when one goes out of range, it autonomously executes: **burn → swap → mint** in a new optimal range

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
│  │  24h expiry     │    │    on-chain enforcement)   │  │
│  └─────────────────┘    └────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
            │
            │ SignedBatchedCall (EIP-712)
            ▼
┌─────────────────────────────────────────────────────────┐
│                     ALMA Agent                          │
│                                                         │
│  Monitor ─▶ Evaluate ─▶ Plan ─▶ Sign ─▶ Submit          │
│     │          │          │                             │
│     │          │          ├── Burn (PositionManager)    │
│     │          │          ├── Swap (Uniswap Trading API)│
│     │          │          └── Mint (PositionManager)    │
│     │          │                                        │
│     │          └── Out of range? Above threshold?       │
│     │                                                   │
│     └── StateView: pool tick, position range, liquidity │
└─────────────────────────────────────────────────────────┘
```

### The Rebalance Flow

1. **Monitor** — Read position state via `StateView.getSlot0()` and `PositionManager.getPoolAndPositionInfo()`
2. **Evaluate** — Is the position out of range? By how much? Worth rebalancing?
3. **Plan** — Compute burn amounts, get a swap quote from the Uniswap Trading API (`/quote`), calculate new tick range, build mint params
4. **Sign** — Construct a `SignedBatchedCall` (EIP-712) with all calls: approve → burn → swap → mint
5. **Submit** — Send the batch to the user's Calibur-delegated EOA. Calibur validates the signature, the hook enforces the whitelist, and the calls execute as the user

## Security Model

Three layers of protection ensure the agent can only do what it should:

| Layer | What it blocks | How |
|-------|---------------|-----|
| **GuardedExecutorHook** | Direct theft (transfers, unauthorized approvals) | On-chain selector whitelist: only `modifyLiquidities`, `UniversalRouter.execute`, and `approve` → Permit2 are allowed |
| **Key expiry** | Long-term key compromise | Agent keys expire after 24h via Calibur's native settings. Compromised key becomes useless quickly |
| **Agent-side validation** | Bad pools, bad swap prices, bugs | Before signing, the agent validates every call against a whitelist of allowed targets/selectors and pool IDs |
| **Slippage protection** | Value extraction via manipulated swaps | Minimum output amounts enforced in swap calldata |

Even with a compromised agent key, an attacker **cannot**: transfer tokens, send ETH, approve arbitrary spenders, or call any contract/function outside the whitelist. The key expires within 24 hours.

## Uniswap Stack Integration

ALMA is built entirely on the Uniswap stack:

| Component | Usage |
|-----------|-------|
| **Uniswap Trading API** | `/quote` for optimal swap routing, `/swap` for calldata generation via UniversalRouter |
| **Calibur** | EIP-7702 delegation framework — enables agent-signed batched execution as the user |
| **GuardedExecutorHook** | Calibur execution hook — on-chain enforcement of agent permissions |
| **PositionManager** | V4 position lifecycle: `modifyLiquidities` for burn and mint |
| **StateView** | Read pool state (`getSlot0`, `getLiquidity`) for position monitoring |
| **UniversalRouter** | Swap execution target (called via Trading API-generated calldata) |
| **Permit2** | Token approval flow for position minting |
| **V4 SDK** | TypeScript calldata encoding for burn/mint planner actions |

## Deployed Contracts

| Contract | Chain | Address |
|----------|-------|---------|
| GuardedExecutorHook | Base | [`0xaf85D281A31ae891fAE3E62C801461F46b8fD7ab`](https://basescan.org/address/0xaf85D281A31ae891fAE3E62C801461F46b8fD7ab) |
| Calibur (Uniswap) | Base | [`0x000000009B1D0aF20D8C6d0A44e162d11F9b8f00`](https://basescan.org/address/0x000000009B1D0aF20D8C6d0A44e162d11F9b8f00) |

## Project Structure

```
alma/
├── contracts/    # Foundry — GuardedExecutorHook deployment script
├── agent/        # TypeScript — headless monitoring + rebalance service
└── web/          # Next.js — frontend for delegation + position viewing
```

## Setup

### Prerequisites
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (for contracts)
- Node.js 18+ (for agent and web)
- A Uniswap API key from the [Developer Platform](https://developers.uniswap.org/dashboard/)

### Contracts
```bash
cd contracts
forge build
```

### Agent
```bash
cd agent
# Setup instructions coming soon
```

### Frontend
```bash
cd web
# Setup instructions coming soon
```

## On-Chain Proof

*Transaction IDs demonstrating full rebalance flow will be added here.*

## Team

Built at ETHGlobal Cannes 2026 by Carl & Yanis.

**Carl Schmidt** — Business & Product. B.A. Economics & Computer Science (University of Zurich). 7+ years in crypto across product, content, and strategy. Designed early product material for Balancer, published commissioned articles on Starknet, and supported go-to-market for deBridge's Solana expansion.

**Yanis Berkani** — Engineering & Security. B.Sc. Computer Science (EPF Lausanne), M.Sc. Cyber Security (ETH Zurich). 5+ years in DeFi. Lead Smart Contract Developer at Spectra for 3 years, where he built the first permissionless yield derivatives protocol and scaled it to $250M TVL.

## License

MIT
