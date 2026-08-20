# Lightning Wallet production status

Updated: 2026-08-20

## Candidate baseline

- Development branch: `codex/final-production`
- Latest deployed web candidate commit: `6bb8ddb`
- Current GCE API release commit: `80da41e`
- Current code candidate version: `2.21.0`
- Current code candidate commit: `80da41e`
- Latest deployed application version: `2.21.0`
- Last approved historical tag: `stable-v2.0-lightning-wallet`
- Client domain: `https://lightingwallet.com`
- Operator domain: `https://admin.lightingwallet.com`
- API domain: `https://api.lightingwallet.com`
- Final production approval: **not issued**

The historical v2.0 tag is retained for rollback. It is not evidence that every transaction module is production-approved.

## Capability matrix

| Module | Implementation | Current production gate |
|---|---|---|
| Client/operator domain split | Complete | Web candidate `6bb8ddb` is deployed; host routing and zero-console-error browser checks pass |
| Wallet providers | MetaMask, WalletConnect, OKX, Rabby, Phantom, Backpack, Solflare, TronLink | Testnet acceptance complete in code; final manual extension acceptance remains |
| Batch Wallet | Local EVM/Solana/TRON generation, Worker execution, encrypted JSON/CSV export, control verification | Implemented; never uploads secret material |
| Batch Transfer | EVM/Solana/TRON planning, CSV validation, Dry Run, progress, retry, active-wallet sender grouping and wallet signing | Mainnet feature flag is off; final chain-specific acceptance required |
| Asset Collector | EVM/Solana/TRON scanning/planning, reserve rules, Dry Run, active-wallet sender grouping and wallet signing | EVM EIP-5792 and Solana batch signing are implemented with safe sequential fallback; mainnet feature flag is off |
| Swap | Provider availability endpoint, quote Worker, route/impact guards, exact approval and wallet signing | Solana/Jupiter and TRON/SUN.io are deployed; EVM needs `ZEROX_API_KEY`; mainnet flag remains off pending authorized wallet acceptance |
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
- RFC 6238 TOTP enrollment, confirmation, one-time recovery codes and verified disable flow are implemented; the enrollment QR is generated locally in browser memory with a manual-key fallback, and activation still requires the operator to complete enrollment in the Security Center.
- Structured logs redact credentials, tokens, cookies and wallet secret fields.
- PostgreSQL backup, guarded restore, readiness checks and rollback release layout are included.
- Guarded rollback defaults to a non-mutating plan, requires exact release confirmation for execution, backs up PostgreSQL, atomically switches releases and automatically restores the original release when deployment verification fails.
- Production deploys now run a fail-closed environment gate before Docker build; placeholder credentials, unsafe origins, invalid MFA/WalletConnect values and premature mainnet flags are rejected without printing secret values.
- CI runs the production environment gate, type checking, tests, production build and Docker image builds.

## Current verification baseline

- API tests: 122 passing across 29 files.
- Web tests: 209 passing across 59 files for the current code candidate.
- Type check: passing.
- Production build: passing.
- CI for candidate `184c5ea` (run `32289956843`): passing, including secret scan, type check, tests, production build, dependency gate and both Docker images.
- CI for code candidate `c670e31` (run `32294819780`): passing, including secret scan, type check, 113 API tests, 199 Web tests, production build, dependency gate and both Docker images.
- Compatibility fix `111d279` passed Production CI run `32295696283`, including credential scan, type check, 117 API tests, 199 Web tests, production build, production dependency gate and both Docker images.
- Candidate `5258b12` passed Production CI run `32347721319`, including credential scan, type check, 117 API tests, 200 Web tests, production build, production dependency gate and both Docker images.
- Operations-hardening candidate `5be4e2e` passed Production CI run `32349813299`, including production environment-gate tests, credential scan, type check, 117 API tests, 200 Web tests, production build, dependency gate and both Docker images.
- Provider-approval preflight fix `01a7dc1` passed Production CI run `32350485348`, including the environment gate, credential scan, type check, 117 API tests, 200 Web tests, production build, dependency gate and both Docker images.
- Guarded rollback candidate `175caff` passed Production CI run `32351059019`, including rollback-planner tests, environment-gate tests, credential scan, type check, 117 API tests, 200 Web tests, production build, dependency gate and both Docker images.
- MFA QR candidate `94c2b99` passed Production CI run `32372450835`, including the environment gate, rollback tests, credential scan, type check, 117 API tests, 202 Web tests, production build, dependency gate and both Docker images.
- SUN.io candidate `91397dd` passes 122 API tests, 209 Web tests, type checking, the default production build, credential scanning and local API/Web Docker image builds. A live read-only TRX/USDT quote returned three verified candidates in 397 ms, and its no-hook V4 route produced Universal Router calldata without requesting a wallet or broadcasting.
- SUN.io implementation `91397dd` passed Production CI run `32376052339`; deployment-readiness fix `6bb8ddb` passed Production CI run `32377723421`. Both runs include credential scanning, type checking, 122 API tests, 209 Web tests, production build, dependency gating and both Docker image builds.
- Live-provider acceptance commit `80da41e` passed Production CI run `32379623180`, including its offline positive/negative fixtures, the full 331-test suite, production build, dependency gate and both Docker image builds.
- Vercel Production deployment `bbMhTpsFoAHHrcX7MwqMLRQr8BC7` (`https://lightning-wallet-31n7fsxs1-sjxs999999-archs-projects.vercel.app`) serves web candidate `6bb8ddb` as v2.21.0. The client route, operator link, SUN.io copy, Dry Run default and error boundaries were verified with zero browser-console errors.
- GCE current immutable operations release is `80da41e`; the running v2.21.0 API/Web, PostgreSQL and Redis containers are healthy. Rollback points to `6bb8ddb`, and pre-deploy backup `lightning-20260820T135139Z.dump` is retained.
- A production read-only TRX/USDT quote through `api.lightingwallet.com` returned HTTP 200 and three verified SUN.io mainnet candidates. The request used only public addresses and exact amounts; wallet access, signature and broadcast were not requested.
- The first guarded v2.21 rollout exposed an API-startup readiness race in external acceptance. No data was lost; containers became healthy, the production links were corrected, and `6bb8ddb` now waits for Docker health before acceptance or rollback decisions.
- Production HTTP acceptance: passing across client, operator, API, security headers, provider truthfulness and CORS.
- The protected GCE environment passes the non-strict production preflight with mainnet execution and mainnet Swap disabled. The strict gate correctly remains closed for the unconfigured external providers and real Flash Loan application.
- The production rollback Dry Run resolved current release `80da41e`, target release `6bb8ddb` and the protected backup directory, and passed environment and Compose preflight without changing links, containers or database state.
- Production dependency audit: 0 critical, 0 high, 6 moderate transitive SUN/Solana/Jayson/UUID advisories with no current upstream fix. No unsafe downgrade is applied.

## Required before final approval

1. Enroll the operator authenticator before enabling `ADMIN_TOTP_SECRET`.
2. Configure and verify any external provider being claimed: WalletConnect, 0x, Paymaster, market holder data, crash reporting, notification delivery and a real Flash Loan app. The final environment must pass `STRICT_EXTERNAL_PROVIDERS=true ./scripts/check-production-env.sh`.
3. Perform authorized testnet then limited-mainnet wallet acceptance for EVM, Solana and TRON, recording public transaction hashes only.
4. Run the final wallet/provider regression and a timed rollback drill.

Until those gates pass, the product must be described as a production candidate and not as fully mainnet-approved.
