# Changelog

All notable stable Lightning Wallet releases are recorded here.

## Unreleased production candidate

### Changed

- Separated the public non-custodial client (`lightingwallet.com`) from the authenticated operator console (`admin.lightingwallet.com`).
- Added durable browser-local public operation history and authenticated metadata-only operator history.
- Added revocable HttpOnly operator sessions, optional TOTP, default-deny API authorization and stricter production CSP.
- Added truthful Swap provider availability so unconfigured EVM/TRON adapters are disabled instead of reported as generic RPC failures.
- Hardened batch transfer, asset collection, Swap, GasFree and Launchpad persistence against corrupted or sensitive browser data.
- Added a public non-custodial client home with live capability gates and direct separation from the operator console.
- Added one-prompt Solana batch signing, bounded concurrent broadcasting, retry/backoff and confirmation polling.
- Added same-network fallback RPC handling for asset scanning and reused EVM gas-price reads across a Worker scan session.
- Added an executable production HTTP acceptance gate covering both domains, API readiness, security headers, provider status and CORS.
- Protected production metrics with a dedicated bearer token and isolated the embedded compatibility frame from other client routes.
- Preserved exact fixed-point transfer and collection totals without JavaScript floating-point conversion.
- Added live token-decimal verification for EVM, Solana and TRON and fail-closed planning when CSV decimals disagree with chain metadata.
- Added pause-aware Solana batch broadcasting and retained the single wallet batch-signature prompt.
- Added production TLS hostname preflight so a release cannot restart Nginx with a missing or mismatched certificate.
- Added active-wallet sender grouping for multi-sender EVM, Solana and TRON batch-transfer and asset-collection plans, leaving unmatched senders pending until the user switches wallets.
- Added one-prompt EVM EIP-5792 and Solana `signAllTransactions` asset-collection execution with safe sequential fallback when the wallet lacks batch support.
- Prevented duplicate EVM retries after a batch identifier has been returned, and stopped unbroadcast signed Solana transactions when the page is closed.
- Replaced floating-point collection-amount checks with exact positive-decimal validation.
- Added authenticated operator Authenticator enrollment with current-password reauthentication, ten-minute confirmation expiry and automatic revocation of other sessions.
- Added AES-256-GCM protection for stored TOTP secrets and one-time recovery codes stored only as server-keyed hashes.
- Added Authenticator recovery-code login and verified disable flow while preserving the legacy environment-managed TOTP mode.
- Added an 8 GiB deployment disk preflight so Docker releases fail before image construction instead of exhausting the host mid-build.
- Replaced the Launchpad message-only deployment intent with client-built testnet deployments for Sepolia ERC-20, Solana Devnet SPL Token and TRON Nile TRC-20.
- Added pre-signature fee/cap disclosure, strict network guards, explicit wallet confirmation, on-chain confirmation, explorer links and browser-local public deployment history.
- Added reproducible OpenZeppelin artifacts from pinned upstream and checksum-verified official TRON Solidity compilers; fixed-supply deployment revokes Solana mint authority and exposes no later mint function on EVM/TRON.
- Added the missing Vercel Serverless Launchpad validation route, shared strict draft validation and an explicit public-route policy so the client flow cannot fail with a 404 or require an operator session.

### Production verification

- Code candidate `c670e31` passed Production CI run `32294819780`: secret scan, type check, 113 API tests, 199 Web tests, production build, high/critical dependency gate and both Docker image builds. It is not yet deployed.
- Compatibility fix `111d279` passes 117 API tests, 199 Web tests, type checking, production build and credential scanning locally; Production CI is pending.
- Candidate commit `184c5ea` passed 113 API tests, 192 Web tests, type checking, production build, CI, secret scanning, dependency gating and both Docker image builds.
- Version `2.19.0` from the exact candidate is deployed to GCE API release `184c5ea` and Vercel Production deployment `GqCQM29fxZ6xVDVPzse3qe6U4yzB`.
- Production HTTP acceptance, API/PostgreSQL/Redis readiness, metrics authorization, host routing, CORS and zero-console-error checks pass.
- The production MFA encryption key and database schema are configured, while enrollment remains intentionally inactive until the operator confirms a live Authenticator code.

### Release gate

- This section is not a stable release and has no final mainnet approval.
- EVM Swap, TRON Swap, sponsored GasFree and real Flash Loan logic remain provider/adapter gated; Launchpad still requires real-wallet testnet acceptance.
- Mainnet transaction flags remain disabled until chain-specific acceptance is complete.

## stable-v2.0-lightning-wallet

### Added

- PostgreSQL-backed Automation Center with a persistent task scheduler.
- Price, watchlist, portfolio, Gas and health-monitoring rules.
- Telegram, Email and signed HTTPS Webhook channel management.
- Notification Center with masked destinations and Dry Run delivery checks.
- Thirty-second API, PostgreSQL and scheduler health monitoring.
- Retry queue and complete job history with attempt tracking.
- Automatic schema initialization for existing and new deployments.

### Security

- Automation is read-only by default and never invokes wallet signing or transaction broadcasting.
- Private keys, mnemonics and seed phrases are rejected by strict request schemas.
- New notification channels are disabled by default; real delivery requires an explicit server flag.
- Telegram tokens, Email credentials and Webhook signing secrets are environment-only.
- Webhooks require public HTTPS destinations and use HMAC-SHA256 signatures.
- Notification destinations are masked in API responses and the UI.
- All Automation endpoints require an authenticated operator session.

### Verification

- Implementation commit: `59a2395`
- API and web tests: 70/70 PASS
- Type check, production build and Docker build: PASS
- Scheduler, Dry Run execution, health monitor and job history: PASS
- Notification validation, masking and disabled-delivery boundary: PASS
- Unauthenticated request rejection: PASS
- Preview route and no-white-screen behavior: PASS
- Preview: `http://localhost:4173/automation`

## stable-v1.9-market-center

### Added

- Read-only EVM, Solana and TRON market overview and Token search.
- Live Token price, market cap, FDV, liquidity, volume and 24-hour transaction metrics.
- OHLCV price-history chart and recent public transaction activity.
- Browser-local watchlist and price alerts.
- Optional normalized holder-count and top-holder provider integration.
- Explicit unavailable states for missing holder data and upstream provider failures.

### Security

- Market endpoints are authenticated, read-only GET routes.
- No private keys, mnemonics, signing or transaction broadcasting were introduced.
- External market calls use bounded timeouts and sanitized normalized responses.
- Watchlists and alerts store public Token metadata locally and never upload wallet material.
- No simulated holder or market data is presented as real data.

### Verification

- Implementation commit: `88d0827`
- API and web tests: 65/65 PASS
- Type check, production build and Docker build: PASS
- Live EVM WETH search and market-detail lookup: PASS
- Nine public pools, 100 OHLCV points and 100 recent trades loaded: PASS
- Preview route, provider degradation and no-white-screen behavior: PASS
- Preview: `http://localhost:4173/markets`

## stable-v1.8-project-center

### Added

- PostgreSQL-backed EVM, Solana and TRON project registry.
- Project list, details, status and current version views.
- Public logo, banner, website, social and whitepaper metadata presentation.
- Contract information and deployment history.
- Metadata version history.
- Name and Symbol search with chain and status filters.
- Project version and deployment-history database tables and indexes.

### Security

- Project Center exposes authenticated read-only GET endpoints only.
- No project mutation, transaction signing or broadcasting routes were added.
- Metadata responses use a strict public-field whitelist.
- Private-key and mnemonic fields are not returned.
- Search and filter queries are parameterized.
- Non-HTTP(S) metadata links are removed.

### Verification

- Implementation commit: `2b34013`
- API and web tests: 62/62 PASS
- Type check, production build and Docker build: PASS
- Three-chain project list and detail queries: PASS
- Version, deployment and combined-filter queries: PASS
- Preview reload and error-boundary validation: PASS
- Browser console errors: 0
- Preview: `http://localhost:4173/projects`

## stable-v1.7-launchpad

### Added

- Five-step Token creation, metadata, media, liquidity and review wizard.
- EVM Sepolia, Solana Devnet and TRON Nile deployment-plan support.
- Logo and banner preview plus PDF whitepaper validation.
- Website and social-link editor with HTTP(S)-only validation.
- Realtime Token information preview.
- Worker-based fixed-point liquidity initialization planning.
- Deployment checklist and EVM, Solana and TRON wallet-signature adapters.

### Security

- Uploads remain local; the API receives only sanitized file descriptors.
- SVG, executable, unsupported and oversized files are rejected.
- Private keys and mnemonics are never accepted or stored.
- The server does not sign or broadcast deployment transactions.
- Non-Dry-Run flows require explicit user-wallet confirmation.

### Verification

- Implementation commit: `8c23402`
- API and web tests: 56/56 PASS
- Type check, production build and Docker build: PASS
- Three-chain Dry Run plans: PASS
- 1,000 Worker liquidity plans: approximately 0.542 ms
- Preview reload and error-boundary validation: PASS
- Browser console errors: 0
- Preview: `http://localhost:4173/launchpad`

## stable-v1.6-gasfree

### Added

- Gas Sponsor abstraction and configurable HTTP Paymaster adapter.
- Authenticated Sepolia RPC gas estimation.
- Automatic gas top-up planning with minimum-reserve controls.
- Standard, Silver and Gold VIP gas policies.
- Worker-based planning, 30-second gas monitoring and metadata-only local history.
- Dry Run Sponsor eligibility validation and isolated provider failures.

### Security

- Private keys, mnemonics and signing material are never accepted or stored.
- The API does not sign or broadcast transactions.
- Real execution remains behind explicit user-wallet confirmation and signature.
- Unauthenticated requests and mainnet Sponsor requests are rejected.
- The stable environment remains Dry Run only until an approved Paymaster is configured.

### Verification

- Implementation commit: `eaf7c92`
- API and web tests: 48/48 PASS
- Type check, production build and Docker build: PASS
- Live Sepolia RPC estimate: PASS
- 1,000 Worker plans: approximately 0.597 ms
- Preview reload and history persistence: PASS
- Browser console errors: 0
- Preview: `http://localhost:4173/gasfree`

## stable-v1.5-flash-loan

### Added

- Navigation and embedded integration for the existing FlashForge application.
- Five-minute authenticated integration sessions restricted to the operator role.
- Shared public wallet address, Sepolia network, dark theme and mandatory Dry Run context.
- Metadata-only Flash Loan history bridge with strict field sanitization.
- Standalone launch fallback, service health status and isolated error handling.

### Security

- Flash Loan logic was not rewritten and server-side signing was not added.
- Private keys, mnemonics, seed phrases and signing capability are never shared.
- Unauthenticated, mainnet and non-Dry-Run integration sessions are rejected.
- Cross-window messages require the configured origin and reject sensitive fields.
- The embedded application is constrained by an iframe sandbox.

### Verification

- Integration commit: `64f622d`
- API and web tests: 40/40 PASS
- Type check, production build and Docker build: PASS
- API health, authenticated session and browser refresh checks: PASS
- Browser console errors: 0
- Preview: `http://localhost:4173/flash-loan`
- FlashForge currently operates in legacy compatibility mode because its existing build does not acknowledge the optional shared message protocol.

## stable-v1.4-swap

### Added

- EVM 0x AllowanceHolder, Solana Jupiter and configurable TRON Swap adapters.
- Aggregated quotes, best-route selection, minimum received amount and price impact.
- Slippage controls, exact-amount approval and wallet-signature execution boundaries.
- Dry Run, Worker quote requests, 30-second automatic refresh and local Swap history.
- Quote timeout and empty-route failure handling.

### Security

- No private keys, mnemonics or server-side transaction signing.
- Mainnet execution remains disabled unless explicitly enabled.
- Wallet rejection results in no broadcast.
- High slippage and excessive price impact are blocked.

### Verification

- Implementation commit: `343f617`
- Final validation commit: `e7f1358`
- Swap tests: 9/9 PASS
- 1,000-route selection performance: approximately 1 ms
- 100 live Jupiter quote requests: 52.94 ms average, 100/100 successful
- Production build and Docker Preview: PASS
- No real testnet Swap was broadcast because authorized funded test wallets were unavailable.

## stable-v1.3-asset-collector

### Added

- EVM, Solana and TRON wallet asset scanning.
- Native coin and configured token detection.
- Minimum-balance retention and automatic fee estimation.
- Client-side Dry Run and batch collection workflow.
- Worker-based scanning with realtime progress.
- Pause, resume, failed-task retry, session logs and CSV result export.
- BigInt fixed-point collection calculations.

### Security

- Private keys and mnemonics remain outside the API, database and logs.
- Real collection transactions require wallet confirmation and signature.
- Sensitive CSV fields are rejected.
- Individual RPC failures are isolated without blanking the page.

### Verification

- Implementation commit: `600e895`
- Asset Collector tests: 6/6 PASS
- 1,000-task planning performance: approximately 28 ms
- Production build: PASS
- Docker build and local Preview: PASS

## stable-v1.2-batch-transfer

- Added EVM, Solana and TRON batch transfers.
- Added CSV templates, validation, Dry Run, progress, pause/resume, retry and result export.

## stable-v1.1-wallets

- Added client-side EVM, Solana and TRON batch wallet generation.
- Added public CSV and encrypted JSON export.

## stable-v1.0-local

- Established the verified local frontend, API, PostgreSQL, Redis and Docker baseline.
