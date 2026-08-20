# Lightning Wallet production status

Updated: 2026-08-20

## Candidate baseline

- Development branch: `codex/final-production`
- Latest deployed candidate commit: `5258b12`
- Current code candidate version: `2.20.0`
- Current code candidate commit: `5be4e2e`
- Latest deployed application version: `2.20.0`
- Last approved historical tag: `stable-v2.0-lightning-wallet`
- Client domain: `https://lightingwallet.com`
- Operator domain: `https://admin.lightingwallet.com`
- API domain: `https://api.lightingwallet.com`
- Final production approval: **not issued**

The historical v2.0 tag is retained for rollback. It is not evidence that every transaction module is production-approved.

## Capability matrix

| Module | Implementation | Current production gate |
|---|---|---|
| Client/operator domain split | Complete | Candidate `5258b12` is deployed; host routing and console checks pass |
| Wallet providers | MetaMask, WalletConnect, OKX, Rabby, Phantom, Backpack, Solflare, TronLink | Testnet acceptance complete in code; final manual extension acceptance remains |
| Batch Wallet | Local EVM/Solana/TRON generation, Worker execution, encrypted JSON/CSV export, control verification | Implemented; never uploads secret material |
| Batch Transfer | EVM/Solana/TRON planning, CSV validation, Dry Run, progress, retry, active-wallet sender grouping and wallet signing | Mainnet feature flag is off; final chain-specific acceptance required |
| Asset Collector | EVM/Solana/TRON scanning/planning, reserve rules, Dry Run, active-wallet sender grouping and wallet signing | EVM EIP-5792 and Solana batch signing are implemented with safe sequential fallback; mainnet feature flag is off |
| Swap | Provider availability endpoint, quote Worker, route/impact guards, exact approval and wallet signing | Solana/Jupiter available; EVM needs `ZEROX_API_KEY`; TRON needs `TRON_SWAP_PROVIDER_URL`; mainnet flag off |
| Flash Loan | Isolated Sepolia session bridge and built-in no-broadcast compatibility shell | Referenced historical repository contains no completed Flash Loan app; real integration is blocked on an actual provider application/API |
| GasFree | Sepolia estimates, VIP policy, Paymaster abstraction, top-up planning and user-wallet signing | Sponsored transactions blocked until an approved Paymaster URL is configured |
| Launchpad | OpenZeppelin fixed-supply ERC-20/TRC-20 and SPL Token deployment transactions are built client-side for Sepolia, Solana Devnet and TRON Nile | Automated adapter tests pass; real wallet testnet acceptance is still required before approval |
| Project Center | Public read and local validated project plans; authenticated operator metadata management | Ready for metadata use |
| Market Center | Read-only price, liquidity, FDV, volume, history, trades, watchlists and alerts | Holder data needs an optional provider |
| Automation Center | Scheduler, monitoring, Dry Run notifications, retries and job history | Real delivery remains off until provider credentials and explicit enablement |
| Unified history | Browser-local public metadata plus authenticated operator database history | Ready; sensitive material is rejected/redacted |

## Verified engineering controls

- Client routes and operator routes are separate.
- Client signing modules are not exposed in the operator route surface.
- Private keys and mnemonics remain in the browser/extension; API schemas do not accept them.
- Encrypted wallet export uses AES-256-GCM with PBKDF2-SHA-256.
- Real transactions require the user wallet; the server does not sign or broadcast.
- Error boundaries isolate route, Worker, RPC and provider failures to prevent blank pages.
- Operator sessions are revocable HttpOnly cookies with default-deny API authorization, CSRF checks and rate limits.
- RFC 6238 TOTP enrollment, confirmation, one-time recovery codes and verified disable flow are implemented; activation still requires the operator to complete enrollment in the Security Center.
- Structured logs redact credentials, tokens, cookies and wallet secret fields.
- PostgreSQL backup, guarded restore, readiness checks and rollback release layout are included.
- Production deploys now run a fail-closed environment gate before Docker build; placeholder credentials, unsafe origins, invalid MFA/WalletConnect values and premature mainnet flags are rejected without printing secret values.
- CI runs the production environment gate, type checking, tests, production build and Docker image builds.

## Current verification baseline

- API tests: 117 passing across 27 files.
- Web tests: 200 passing across 56 files for the current code candidate.
- Type check: passing.
- Production build: passing.
- CI for candidate `184c5ea` (run `32289956843`): passing, including secret scan, type check, tests, production build, dependency gate and both Docker images.
- CI for code candidate `c670e31` (run `32294819780`): passing, including secret scan, type check, 113 API tests, 199 Web tests, production build, dependency gate and both Docker images.
- Compatibility fix `111d279` passed Production CI run `32295696283`, including credential scan, type check, 117 API tests, 199 Web tests, production build, production dependency gate and both Docker images.
- Candidate `5258b12` passed Production CI run `32347721319`, including credential scan, type check, 117 API tests, 200 Web tests, production build, production dependency gate and both Docker images.
- Operations-hardening candidate `5be4e2e` passed Production CI run `32349813299`, including production environment-gate tests, credential scan, type check, 117 API tests, 200 Web tests, production build, dependency gate and both Docker images.
- Vercel Production deployment `HRZfYMQyjxDNjEdB3VWh1cKAvnGf` for candidate `5258b12`: ready; client and operator domains serve v2.20.0 with zero browser-console errors and enforce hostname route isolation.
- GCE API release `5258b12`: healthy; PostgreSQL and Redis readiness pass. Rollback points to release `184c5ea`, and pre-deploy backup `lightning-20260820T081545Z.dump` is retained.
- Production HTTP acceptance: passing across client, operator, API, security headers, provider truthfulness and CORS.
- Production dependency audit: 0 critical, 0 high, 3 moderate transitive Solana/Jayson/UUID advisories. No unsafe downgrade is applied.

## Required before final approval

1. Enroll the operator authenticator before enabling `ADMIN_TOTP_SECRET`.
2. Configure and verify any external provider being claimed: WalletConnect, 0x, TRON Swap, Paymaster, market holder data, crash reporting, notification delivery and a real Flash Loan app. The final environment must pass `STRICT_EXTERNAL_PROVIDERS=true ./scripts/check-production-env.sh`.
3. Perform authorized testnet then limited-mainnet wallet acceptance for EVM, Solana and TRON, recording public transaction hashes only.
4. Run the final wallet/provider regression and a timed rollback drill.

Until those gates pass, the product must be described as a production candidate and not as fully mainnet-approved.
