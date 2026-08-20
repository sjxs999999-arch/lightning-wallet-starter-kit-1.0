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

- Runtime, CI, browser, Preview and production deployment results will be recorded after candidate validation.
