# Lightning Wallet v2.33 production candidate

Version 2.33 adds a read-only, testnet-first asset view to the encrypted local Wallet Center. It reuses the existing network-attested Asset Collector scanner and does not enable a mainnet execution gate.

## Added

- On-demand native and Token balance display for EVM Sepolia, Solana Devnet and TRON Nile/Shasta.
- Solana SPL Token and Token-2022 discovery through standard public RPC methods.
- EVM ERC-20 and TRON TRC-20 balance display for locally registered custom Token contracts.
- Exact testnet attestation before any balance request.
- Bounded custom-Token concurrency, a 50-contract limit and manual refresh to reduce public RPC rate limiting.
- Panel-local RPC errors and stale-response suppression so switching wallets or a failed provider cannot blank the page.
- Lazy-loaded portfolio UI and scanner code so Wallet Center startup remains small.

## Security boundary

- The feature is read-only and sends only public wallet addresses and public Token contracts directly to the selected testnet RPC.
- It never unlocks the vault, decrypts a private key, requests a signature, calls the API with secret material or broadcasts a transaction.
- Corrupted, duplicate, unrelated or excessive public Token metadata is skipped and reported locally.
- Mainnet batch transfer, asset collection, Swap, Launchpad and Bridge gates remain disabled.

## Verification status

- Runtime commit: `e58173a`.
- API: 159 tests passing across 33 files.
- Web: 293 tests passing across 75 files, including testnet attestation, custom-Token sanitization, discovered-Token de-duplication and actionable error-copy coverage.
- Type checking, lint, production build, credential scan, environment/rollback/provider gates and both local Docker image builds: passing.
- Production dependency gate: zero high or critical advisories; six moderate transitive advisories remain without a compatible upstream fix.
- Production CI run `32415927314`: passing, including verification and Docker jobs.
- Vercel Preview `dpl_EPVFRUUoVnduYgi3nvk1coYbPVbR`: ready.
- Vercel Production `dpl_HLK51wFAx3gqcv2x4gUEnEhmEMXa`: ready on `lightingwallet.com` and `admin.lightingwallet.com`.
- GCE immutable release: `/opt/lightning-wallet/releases/e58173a`; rollback: `/opt/lightning-wallet/releases/11c252f`; retained pre-deploy backup: `lightning-20260820T205300Z.dump`.
- Local browser acceptance created an isolated temporary EVM vault, rendered the lazy asset panel and confirmed that a blocked public Sepolia RPC produces a panel-local error instead of a white screen. No secret was inspected or transmitted.
- Production browser checks pass for the v2.33 client Wallet Center, operator/client separation and zero console errors. Vercel reported no error-level deployment logs.
- Production HTTP, CORS, security-header, API/PostgreSQL/Redis and read-only Provider acceptance pass. SUN.io returned three routes in 0.409085 seconds; LI.FI returned one route in 0.732777 seconds.
- No automated acceptance connected a wallet, requested a signature or broadcast a transaction. Authorized real-wallet acceptance remains required.
- Final approval remains fail-closed on exactly five external-provider prerequisites, wallet acceptance and four disabled mainnet gates.
