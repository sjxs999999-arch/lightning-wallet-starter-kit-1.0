# Lightning Wallet v2.34 production candidate

Version 2.34 extends the Wallet Center's read-only asset view from testnets to the frozen multi-chain mainnet scope. It does not enable signing, broadcasting or any mainnet transaction gate.

## Added

- Read-only native and registered-Token balances for Ethereum, BNB Smart Chain, Polygon, Base and Arbitrum One.
- Read-only native and discovered SPL/Token-2022 balances for Solana Mainnet.
- Read-only native and registered TRC-20 balances for TRON Mainnet.
- Existing Sepolia, Solana Devnet, TRON Nile and TRON Shasta profiles remain available.
- Exact EVM Chain ID, Solana Genesis or approved official TRON hostname attestation before every scan session.
- Per-wallet network selector with explicit Mainnet/Testnet labels and stale-result clearing on network changes.
- Docker build plumbing for dedicated browser-local and portfolio RPC settings.

## Security boundary

- This release is read-only. It never unlocks the vault, reads a private key, requests a signature or broadcasts a transaction.
- Only public addresses and public Token contracts are sent directly from the browser to the selected RPC.
- Every `VITE_*` RPC URL is browser-visible. Operators must never embed secret API keys in these values.
- A network mismatch fails before any balance request.
- All mainnet execution, Swap, Launchpad and Bridge gates remain disabled.

## Verification status

- Commit `3883c04` passes 159 API tests, 301 Web tests, type checking, lint, production build, both Docker image builds, secret/environment/rollback/provider gates and the high/critical production dependency gate.
- All 11 default read-only RPC profiles returned the exact expected EVM Chain ID, Solana Genesis or an official allowed TRON endpoint response.
- Production CI run `32418571919` passed.
- Vercel Preview `dpl_4tshoKFSS8D5KzHY1TbMgomb6aQy` and Vercel Production `dpl_42jCZ5YMxnqJXE9JTYzfe2m5zyxK` are Ready. `lightingwallet.com/wallets` serves v2.34.0 with the expected CSP and frame-denial headers.
- Local and production browser acceptance verified Wallet Center rendering, the six EVM read-only network choices, BSC Mainnet labeling and zero console errors. No wallet, signature or broadcast was requested.
- GCE immutable release `3883c04` and API v2.34.0 are deployed. Rollback points to `e58173a`; pre-deploy PostgreSQL backup `/opt/lightning-wallet/backups/lightning-20260823T183613Z.dump` is retained, and API, Web, PostgreSQL and Redis are healthy.
- Post-rollout HTTP, CORS, security headers, client refresh, operator-route isolation and zero-console-error browser checks pass. SUN.io returned three verified routes in 0.427969 seconds and LI.FI returned one verified same-chain EVM route in 0.728238 seconds without wallet access, signing or broadcast. Vercel reported no error-level production logs during the acceptance window.
- Final readiness remains fail-closed on exactly five external providers, authorized-wallet signing acceptance and the disabled mainnet execution, Swap, Launchpad and Bridge gates.
