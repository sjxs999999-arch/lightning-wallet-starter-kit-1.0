# Lightning Wallet v2.21 production candidate

Version 2.21 adds an executable TRON Swap integration while preserving the production safety gate.

## Included

- Official SUN.io Smart Router mainnet quotes.
- Strict matching of sell token, buy token, raw amount and slippage floor.
- Verified no-hook V4 and established SUN pool route validation.
- Exact TRC-20 Permit2 approval instead of unlimited approval.
- Local TronLink/OKX typed-data and transaction signatures.
- Client-side broadcast and confirmed receipt checks.
- No private-key, mnemonic, server-signing or server-broadcast path.

## Verification boundary

The real SUN.io quote and Universal Router calldata build are verified without requesting a wallet or broadcasting. `VITE_ENABLE_MAINNET_SWAP` remains disabled in production until an authorized limited-value wallet acceptance test is recorded.

EVM Swap still requires `ZEROX_API_KEY`. Flash Loan, sponsored GasFree and optional data/notification providers remain separately gated.
