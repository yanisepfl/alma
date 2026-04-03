export const POSITION_MANAGER = "0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4" as const;
export const STATE_VIEW = "0xe1dd9c3fa50edb962e442f60dfbc432e24537e4c" as const;
export const CHAIN_ID = 11155111; // Sepolia

export const POSITION_MANAGER_ABI = [
  {
    name: "getPoolAndPositionInfo",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      {
        name: "poolKey",
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
      { name: "info", type: "uint256" },
    ],
  },
  {
    name: "getPositionLiquidity",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "liquidity", type: "uint128" }],
  },
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "owner", type: "address" }],
  },
] as const;

export const STATE_VIEW_ABI = [
  {
    name: "getSlot0",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "protocolFee", type: "uint24" },
      { name: "lpFee", type: "uint24" },
    ],
  },
  {
    name: "getLiquidity",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [{ name: "liquidity", type: "uint128" }],
  },
] as const;

export const TOKEN_SYMBOLS: Record<string, string> = {
  "0x0000000000000000000000000000000000000000": "ETH",
  "0xfff9976782d46cc05630d1f6ebab18b2324d6b14": "WETH",
  "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238": "USDC",
};

export const QUIRKY_MESSAGES = [
  "Check your ranges!",
  "Ready to rebalance?",
  "How's your position?",
  "Optimize your yield!",
  "What's the move?",
  "Let's get to work!",
];

export const GENERAL_SUGGESTIONS = [
  "How does concentrated liquidity work?",
  "What is impermanent loss?",
  "When should I rebalance my position?",
  "Explain tick ranges to me",
];

export const POSITION_SUGGESTIONS = [
  "Am I in range?",
  "Should I rebalance?",
  "Claim my fees and add them to the range",
  "What's my position worth?",
];
