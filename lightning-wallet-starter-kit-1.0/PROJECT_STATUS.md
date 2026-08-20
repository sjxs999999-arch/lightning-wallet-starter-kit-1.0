# Lightning Wallet production status

Updated: 2026-08-21

## Candidate baseline

- Development branch: `codex/final-production`
- Latest deployed web candidate commit: `2ef4d99`
- Current GCE API release commit: `2ef4d99`
- Current code candidate version: `2.24.0`
- Current code candidate commit: `2ef4d99`
- Latest deployed application version: `2.24.0`
- Last approved historical tag: `stable-v2.0-lightning-wallet`
- Client domain: `https://lightingwallet.com`
- Operator domain: `https://admin.lightingwallet.com`
- API domain: `https://api.lightingwallet.com`
- Final production approval: **not issued**

The historical v2.0 tag is retained for rollback. It is not evidence that every transaction module is production-approved.

## Capability matrix

| Module | Implementation | Current production gate |
|---|---|---|
| Client/operator domain split | Complete | Web candidate `2ef4d99` is deployed; host routing and no-white-screen browser checks pass |
| Wallet providers | MetaMask, WalletConnect, OKX, Rabby, Phantom, Backpack, Solflare, TronLink | Testnet acceptance complete in code; final manual extension acceptance remains |
| Batch Wallet | Local EVM/Solana/TRON generation, Worker execution, encrypted JSON/CSV export, control verification | Implemented; never uploads secret material |
| Batch Transfer | EVM/Solana/TRON planning, CSV validation, Dry Run, progress, retry, active-wallet sender grouping and wallet signing | Mainnet feature flag is off; final chain-specific acceptance required |
| Asset Collector | EVM/Solana/TRON scanning/planning, reserve rules, Dry Run, active-wallet sender grouping and wallet signing | EVM EIP-5792 and Solana batch signing are implemented with safe sequential fallback; mainnet feature flag is off |
| Swap | Provider availability endpoint, quote Worker, route/impact guards, exact approval and wallet signing | EVM/LI.FI, Solana/Jupiter and TRON/SUN.io are deployed; optional 0x comparison remains supported; mainnet flag remains off pending authorized wallet acceptance |
| Flash Loan | Isolated Sepolia session bridge and built-in no-broadcast compatibility shell | Referenced historical repository contains no completed Flash Loan app; real integration is blocked on an actual provider application/API |
| GasFree | Sepolia estimates, VIP policy, Paymaster abstraction, top-up planning and user-wallet signing | Sponsored transactions blocked until an approved Paymaster URL is configured |
| Launchpad | OpenZeppelin fixed-supply ERC-20/TRC-20 and SPL Token transactions are built client-side for Sepolia, five EVM mainnets, Solana Devnet/Mainnet and TRON Nile/Shasta/Mainnet | Mainnet requires both global and Launchpad-specific build gates; both are off, and real-wallet acceptance remains required |
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
- Client crash diagnostics are self-hosted, accept only anonymous metadata under a strict schema, aggregate duplicate fingerprints, expire after 90 inactive days and expose reads only to authenticated operators.
- Operator sessions are revocable HttpOnly cookies with default-deny API authorization, CSRF checks and rate limits.
- RFC 6238 TOTP enrollment, confirmation, one-time recovery codes and verified disable flow are implemented; the enrollment QR is generated locally in browser memory with a manual-key fallback, and activation still requires the operator to complete enrollment in the Security Center.
- Structured logs redact credentials, tokens, cookies and wallet secret fields.
- PostgreSQL backup, guarded restore, readiness checks and rollback release layout are included.
- Guarded rollback defaults to a non-mutating plan, requires exact release confirmation for execution, backs up PostgreSQL, atomically switches releases and automatically restores the original release when deployment verification fails.
- Production deploys now run a fail-closed environment gate before Docker build; placeholder credentials, unsafe origins, invalid MFA/WalletConnect values and premature mainnet flags are rejected without printing secret values.
- CI runs the production environment gate, type checking, tests, production build and Docker image builds.

## Current verification baseline

- API tests: 156 passing across 32 files.
- Web tests: 222 passing across 60 files for the current code candidate.
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
- Privacy-safe diagnostics candidate `300c66f` passed Production CI run `32381332282`, including credential scanning, type checking, 126 API tests, 209 Web tests, production build, dependency gating and both Docker image builds.
- LI.FI EVM Swap candidate `9a25a62` passed Production CI run `32385558905`, including credential scanning, production environment and rollback tests, LI.FI/SUN.io provider fixtures, type checking, 135 API tests, 211 Web tests, production build, dependency gating and both Docker image builds.
- Vercel Production deployment `bbMhTpsFoAHHrcX7MwqMLRQr8BC7` (`https://lightning-wallet-31n7fsxs1-sjxs999999-archs-projects.vercel.app`) serves web candidate `6bb8ddb` as v2.21.0. The client route, operator link, SUN.io copy, Dry Run default and error boundaries were verified with zero browser-console errors.
- GCE current immutable operations release is `80da41e`; the running v2.21.0 API/Web, PostgreSQL and Redis containers are healthy. Rollback points to `6bb8ddb`, and pre-deploy backup `lightning-20260820T135139Z.dump` is retained.
- A production read-only TRX/USDT quote through `api.lightingwallet.com` returned HTTP 200 and three verified SUN.io mainnet candidates. The request used only public addresses and exact amounts; wallet access, signature and broadcast were not requested.
- Vercel Production deployment `3B8sGdocX86uRhyRiMvKQCLGbaBG` (`https://lightning-wallet-etyr2p4rf-sjxs999999-archs-projects.vercel.app`) serves commit `300c66f` as v2.22.0 on `lightingwallet.com`. The client Security Center reports the expected local-only boundaries, while `admin.lightingwallet.com/security` redirects unauthenticated users to the operator login.
- GCE current immutable release is `300c66f`; rollback points to `80da41e`. API v2.22.0, Web, PostgreSQL and Redis are healthy, and the pre-deploy backups `lightning-20260820T144127Z.dump` and `lightning-20260820T144212Z.dump` are retained.
- Production diagnostics acceptance recorded one anonymous aggregate with two occurrences. Anonymous writes return 202, unauthenticated aggregate reads return 401, and no error message, stack, wallet address or identity is accepted.
- Vercel Production deployment `AHWpjUQPT4SBxBFgExnTCYUQNj3M` (`https://lightning-wallet-1cmo3xvf9-sjxs999999-archs-projects.vercel.app`) serves commit `9a25a62` as v2.23.0 on `lightingwallet.com`.
- GCE current immutable release is `9a25a62`; rollback points to `300c66f`. API v2.23.0, Web, PostgreSQL and Redis are healthy, and PostgreSQL backups `lightning-20260820T152717Z.dump` and `lightning-20260820T152839Z.dump` are retained.
- Production EVM Swap browser acceptance returned a verified LI.FI/SushiSwap same-chain Ethereum USDC/WETH route with minimum output, 0.3803% observed price impact, Provider fee, estimated Gas and expiry displayed. The separate live-provider gate returned one LI.FI route in 1.003703 seconds and three SUN.io routes in 0.383144 seconds; neither flow connected a wallet, signed or broadcast.
- Launchpad network candidate `2ef4d99` passed Production CI run `32389530988`, including credential, environment, rollback and provider gates, type checking, 156 API tests, 222 Web tests, production build, production dependency gating and both Docker image builds.
- Vercel Production deployment `Cs4cZM6WQvDk1XSLssbVLrePqzrv` (`https://lightning-wallet-17noxc4bk-sjxs999999-archs-projects.vercel.app`) and GCE immutable release `2ef4d99` serve v2.24.0. GCE rollback points to `9a25a62`, and backup `lightning-20260820T160500Z.dump` is retained.
- Production Launchpad browser acceptance verified the EVM, Solana and TRON network selectors, mainnet-plan validation, disabled mainnet wallet entry, `serverSigning: false`, and refresh without a white screen. No wallet, signature or broadcast was requested. The post-rollout provider gate returned three SUN.io routes in 0.473005 seconds and one LI.FI route in 1.389682 seconds.
- The first guarded v2.21 rollout exposed an API-startup readiness race in external acceptance. No data was lost; containers became healthy, the production links were corrected, and `6bb8ddb` now waits for Docker health before acceptance or rollback decisions.
- Production HTTP acceptance: passing across client, operator, API, security headers, provider truthfulness and CORS.
- The protected GCE environment passes the non-strict production preflight with mainnet execution, mainnet Swap and mainnet Launchpad disabled. The strict gate correctly remains closed on exactly five external prerequisites: WalletConnect Project ID, Paymaster, holder-data provider, real Flash Loan application/API and Automation delivery configuration.
- The production rollback Dry Run resolved current release `80da41e`, target release `6bb8ddb` and the protected backup directory, and passed environment and Compose preflight without changing links, containers or database state.
- Production dependency audit: 0 critical, 0 high, 6 moderate transitive SUN/Solana/Jayson/UUID advisories with no current upstream fix. No unsafe downgrade is applied.

## Required before final approval

1. Enroll the operator authenticator before enabling `ADMIN_TOTP_SECRET`.
2. Configure and verify the remaining gated external providers being claimed: WalletConnect, Paymaster, market holder data, notification delivery and a real Flash Loan app. The final environment must pass `STRICT_EXTERNAL_PROVIDERS=true ./scripts/check-production-env.sh`.
3. Perform authorized testnet then limited-mainnet wallet acceptance for EVM, Solana and TRON, recording public transaction hashes only.
4. Run the final wallet/provider regression and a timed rollback drill.

Until those gates pass, the product must be described as a production candidate and not as fully mainnet-approved.
