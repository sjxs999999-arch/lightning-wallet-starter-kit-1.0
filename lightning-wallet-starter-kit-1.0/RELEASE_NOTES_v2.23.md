# Lightning Wallet v2.23 production candidate

Version 2.23 removes the 0x API key as a required EVM Swap dependency and fixes the public-client quote path on Vercel.

## Included

- LI.FI same-chain EVM aggregation for Ethereum, BSC, Polygon, Base and Arbitrum without a required API key.
- Optional 0x and HTTPS custom-provider comparison with independent strict response validation.
- Exact matching of chain, wallet, Token pair, input amount, minimum output, allowance target and bounded EVM transaction data.
- Provider fees, estimated network Gas and quote expiry displayed before execution.
- A fresh same-provider quote immediately before the wallet confirmation; lower minimum output, high impact, invalid calldata or expiry fails closed.
- Public Fastify and Vercel status/quote parity; Vercel anonymous quotes are limited to 30 per minute per source.
- Live-provider verification for both LI.FI Ethereum USDC/WETH and SUN.io TRX/USDT.

## Security boundary

- Quote requests contain public addresses and exact amounts only.
- Private keys, mnemonics, signatures and wallet secrets are not accepted or forwarded.
- The API never signs or broadcasts.
- Mainnet Swap remains disabled until an authorized wallet acceptance transaction is approved.

## Verification

- API: 135 tests passing across 32 files.
- Web: 211 tests passing across 60 files.
- Type check, production build, credential scan and API/Web Docker image builds: PASS.
- Dependency audit: 0 high, 0 critical; 6 moderate transitive advisories have no current upstream fix.
- A live read-only LI.FI quote returned an executable SushiSwap route with exact allowance, Provider fees and Gas estimate; no wallet, signature or broadcast was requested.
