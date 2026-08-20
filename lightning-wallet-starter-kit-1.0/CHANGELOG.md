# Changelog

All notable stable Lightning Wallet releases are recorded here.

## Unreleased production candidate

### Changed

- Extended the Wallet Center's read-only portfolio to Ethereum, BSC, Polygon, Base, Arbitrum, Solana Mainnet and TRON Mainnet while retaining Sepolia, Solana Devnet, TRON Nile and TRON Shasta.
- Added exact EVM Chain ID, Solana Genesis and approved official TRON hostname attestation before a read-only scan, plus explicit Mainnet/Testnet selection and stale-result clearing.
- Added production Docker build plumbing for isolated browser-visible portfolio RPCs; secret-bearing RPC URLs remain forbidden in `VITE_*` values.
- Added a lazy, read-only Wallet Center portfolio for EVM Sepolia, Solana Devnet and TRON Nile/Shasta by reusing the existing network-attested Asset Collector scanner.
- Added Solana SPL/Token-2022 discovery plus registered ERC-20/TRC-20 balance reads, bounded Token concurrency, a 50-contract safety limit and stale-response suppression.
- Kept RPC failures inside the asset panel with actionable retry/fallback copy; the portfolio does not unlock the vault, sign, broadcast or send secret material to the API.
- Extended the encrypted Wallet Center session into Batch Transfer and Asset Collector without changing the stored vault format or introducing a server signer.
- Added one-confirmation sequential one-shot Worker signing for EVM Sepolia, Solana Devnet and TRON Nile/Shasta batch transfer and asset collection, while retaining pause, resume, retry, progress and public-only audit history.
- Added synchronous vault-lock invalidation before signing and broadcast so an already signed transaction is never broadcast after the user locks or leaves the session.
- Added separate local-testnet asset-scan RPC profiles with exact EVM Chain ID, Solana Genesis and official TRON hostname validation plus bounded concurrency for public RPC resilience.
- Added direct browser-local native and Token transfer planning for EVM Sepolia, Solana Devnet and official TRON Nile/Shasta RPCs while keeping every mainnet feature flag disabled.
- Added one-shot Web Worker signing that decrypts one selected key, re-derives and matches its address, signs locally, clears plaintext bytes and returns only an already signed public transaction for client-side broadcast.
- Added explicit preview/confirmation, 90-second transaction expiry, public-only local history, wallet-switch locking during execution and fail-closed sender/network/signature verification.
- Split chain SDKs out of the signing Worker and lazy-loaded TRON planning so the Worker entry is 2.18 kB and the Wallet Center route chunk decreased from approximately 802 kB to 44 kB.
- Replaced the provider-only `/wallets` screen with a complete non-custodial Wallet Center while retaining all ten extension-wallet entries in a separate tab.
- Added a browser-local AES-256-GCM wallet vault with PBKDF2-SHA-256 (600,000 iterations), 15-minute inactivity locking, encrypted backup/restore and strict rejection of plaintext secret fields.
- Added EVM, Solana and TRON wallet creation, mnemonic/private-key import, EVM Keystore import, mnemonic-backed multi-account derivation, receive QR codes, local address book and custom Token metadata.
- Reused the existing locally verified migration flow for temporary key recovery; every reveal is address-verified, auto-cleared and never sent to an API, database or log.
- Connected selected Wallet Center addresses to Batch Transfer with a validated, sender-prefilled CSV template while preserving Dry Run and wallet-signature gates.
- Added a truthful production-readiness contract shared by Fastify and the Vercel fallback, with exactly five external-provider blockers, a separate wallet-acceptance gate and explicit mainnet feature states.
- Made the public capability route authentication-free and removed the stale fallback response that incorrectly marked Flash Loan, GasFree, Swap and other gated modules as ready.
- Added visible final-readiness status to the client and operator settings plus an executable gate that fails until every provider, wallet acceptance and mainnet switch is complete.
- Added `FINAL_WALLET_ACCEPTANCE_APPROVED` to production preflight; any mainnet switch now fails closed until the signed acceptance checklist has been explicitly approved.
- Hardened Solana Batch Trade with the same double mainnet gate, sender-aware wallet selection, exact Mainnet genesis, transaction-payer validation and confirmed/submitted/failed receipt semantics used by the core execution modules.
- Hardened GasFree Sepolia top-up with sender-aware EVM provider discovery, exact-chain/account revalidation, pre-signature Gas estimation and exact successful/submitted/failed receipt persistence.
- Reused sender-aware wallet discovery in Swap, Bridge and Launchpad so an unrelated installed OKX/MetaMask/Phantom/TronLink provider is no longer selected ahead of the already-authorized public sender.
- Added exact switched-chain revalidation, full Solana Mainnet genesis attestation and confirmed EVM/Solana receipt checks to Swap and Bridge execution; failed or ambiguous receipts cannot be reported as successful.
- Added an independent `VITE_ENABLE_MAINNET_BRIDGE` gate and made Swap require both its feature gate and the global mainnet gate. Production preflight rejects every partially enabled mainnet feature combination.
- Corrected the shared Solana Mainnet genesis constant to the complete value returned by the official Mainnet RPC, with regression coverage rejecting the previously truncated fingerprint.
- Replaced fixed OKX-first transaction execution with public-account matching across injected EVM and Solana providers; multi-sender Batch Transfer and Asset Collector now resolve the wallet that is already authorized for the intended sender and refuse ambiguous mismatches.
- Added complete Solana genesis attestation before batch signing and exact official TRON RPC hostname checks in the shared Batch Transfer/Asset Collector execution policy.
- Made EIP-5792 batch receipts task-specific: successful, failed and missing receipts are recorded as confirmed, failed and submitted respectively instead of treating an incomplete batch as fully successful.
- Hardened Wallet Center provider acceptance: EVM now re-reads Sepolia after a requested switch and revalidates the active account before signing; Solana validates the complete Devnet genesis; TRON accepts only exact official testnet hosts and Base58Check-valid addresses.
- Added explicit OKX Wallet entry points for Solana and TRON, unique multi-chain provider identities, failure-state cleanup, and fail-closed Solana/TRON receipt handling so rejected or failed confirmations cannot be recorded as successful.
- Extended the existing client-built Launchpad adapters to Ethereum, BSC, Polygon, Base, Arbitrum, Solana Mainnet, TRON Shasta and TRON Mainnet without adding a server signer.
- Added an independent `VITE_ENABLE_MAINNET_LAUNCHPAD` gate on top of the global mainnet gate; a closed gate rejects before wallet discovery, and production preflight rejects partial or premature enablement.
- Corrected the truncated Solana Devnet genesis fingerprint and added exact full-genesis verification for both Devnet and Mainnet so the real official RPC is no longer rejected or confused with another cluster.
- Added strict chain/network pair validation across Fastify, Vercel and the client, plus official-network TRON RPC host checks and dynamic explorer/fee disclosure.
- Added LI.FI as the default no-key EVM same-chain Swap provider for Ethereum, BSC, Polygon, Base and Arbitrum, while retaining 0x as an optional independently validated comparison source.
- Made public Swap status and metadata-only quote routes consistent across Fastify and Vercel, with a 30-request-per-minute anonymous Serverless limiter.
- Added strict wallet, chain, Token, amount, minimum-output, allowance and transaction-data matching; EVM quotes are refreshed immediately before confirmation and signing.
- Added explicit LI.FI Provider fee, estimated Gas and quote-expiry disclosure in the client, plus live read-only LI.FI acceptance coverage.
- Integrated the official SUN.io Smart Router for TRON mainnet quotes and client-only TronLink/OKX execution without a private-key or server-signing path.
- Added exact TRC-20 Permit2 allowance handling, local typed-data signatures, verified no-hook V4 route support, strict route revalidation and confirmed transaction receipts.
- Kept TRON Swap behind the existing mainnet feature flag until an authorized wallet acceptance transaction is completed.
- Added a bounded post-start Docker health wait so guarded releases do not mistake normal API startup time for a failed deployment and trigger an unnecessary rollback.
- Added a separate live-provider acceptance gate that exercises the production CSRF-protected SUN.io quote path and strictly rejects malformed, unverified-hook or secret-bearing responses without touching a wallet.
- Replaced the non-functional external Crash Reporting placeholder with a self-hosted, rate-limited metadata-only crash aggregator, 90-day retention, protected operator reads, Security Center visibility and a dedicated Prometheus counter.
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
- Isolated the Launchpad Solana Devnet RPC from the production Solana Mainnet RPC so testnet mint deployment cannot change or inherit the network used by batch transfers and asset collection.
- Added a fail-closed production environment gate that rejects placeholder credentials, unsafe origins, invalid MFA/WalletConnect configuration and premature mainnet flags while reporting every external provider still required for final approval.
- Added an explicit-confirmation release rollback tool with preflight-only default mode, pre-switch database backup, atomic release links, production verification and automatic restoration of the original release on failure.
- Added a client-side Authenticator enrollment QR code with a manual-key fallback; the `otpauth://` value is converted to an in-memory PNG locally and is never sent to a QR service.

### Production verification

- Multi-mainnet read-only candidate `3883c04` passes 159 API tests, 301 Web tests, type checking, lint, credential/environment/rollback/provider gates, production build, high/critical production dependency gating and both Docker image builds. Production CI run `32418571919` passed; all 11 default RPC profiles returned their expected network identity.
- Vercel Preview `dpl_4tshoKFSS8D5KzHY1TbMgomb6aQy` and Vercel Production `dpl_42jCZ5YMxnqJXE9JTYzfe2m5zyxK` serve web v2.34.0. Browser acceptance verified the Wallet Center, BSC Mainnet read-only selection, reload-safe rendering and zero console errors without wallet signing or broadcast.
- GCE remains on immutable release `e58173a` / API v2.33.0 because access to the local Google Cloud credential directory was not granted in this run. No production server or database state was changed; v2.34 server rollout remains pending.
- Read-only portfolio candidate `e58173a` passes 159 API tests, 293 Web tests, type checking, lint, credential/environment/rollback/provider gates, production build, high/critical dependency gating and both local Docker image builds. Production CI run `32415927314` passed.
- Vercel Preview `dpl_EPVFRUUoVnduYgi3nvk1coYbPVbR`, Vercel Production `dpl_HLK51wFAx3gqcv2x4gUEnEhmEMXa` and GCE immutable release `e58173a` serve v2.33.0. GCE rollback points to `11c252f`; backup `lightning-20260820T205300Z.dump` is retained.
- Production browser checks verified the client Wallet Center, v2.33 version, no-white-screen state, zero console errors and operator/client isolation. HTTP and read-only provider acceptance pass without wallet access, signing or broadcast.
- Shared-vault candidate `11c252f` passes 159 API tests, 288 Web tests, type checking, lint, credential/environment/rollback/provider gates, production build, high/critical dependency gating and both local Docker image builds. Production CI run `32413522190` passed.
- Vercel Preview deployment `dpl_Hv7YYB8LwCwfrVcbHVHBFkmTdtfQ`, Vercel Production deployment `dpl_CfmzuANq3dFYR9JsimGXYCkZdnDi` and GCE immutable release `11c252f` serve v2.32.0. GCE rollback points to `5963902`; backup `lightning-20260820T202520Z.dump` is retained.
- Production browser checks verified the Batch Transfer and Asset Collector local-vault entry points, client-tab session reuse, refresh locking, operator/client isolation and no white screen. HTTP, CORS, security-header, API/PostgreSQL/Redis and read-only SUN.io/LI.FI acceptance pass without wallet access, signing or broadcast.
- Local-signing candidate `5963902` passes 159 API tests, 278 Web tests, type checking, lint, credential/environment/rollback/provider gates, production build and both local Docker image builds. Browser acceptance verified v2.31 route/reload, automatic vault locking and RPC-error isolation without requesting a signature or broadcast.
- Production CI run `32409972622` passed for head `5d65e03`. Vercel Production deployment `dpl_8BZayhFfX29GoY5QELLjtBwEtbWt` and GCE immutable release `5963902` now serve v2.31.0; rollback points to `a5c2b60` and backup `lightning-20260820T195002Z.dump` is retained.
- Post-rollout production HTTP, CORS, security headers, API/PostgreSQL/Redis, browser route/reload and read-only SUN.io/LI.FI verification pass. Mainnet execution remains disabled and no automated acceptance connected a wallet, signed or broadcast.
- Wallet Center candidate `a5c2b60` passes 159 API tests, 272 Web tests, type checking, lint, credential/environment/rollback gates, production build and both local Docker image builds. Browser route, provider-tab, refresh and Batch Transfer handoff checks pass without wallet access, signing or broadcasting.
- Candidate head `416a3d9` passed Production CI run `32406199136`, including both Docker image builds and the high/critical dependency gate.
- Vercel Production deployment `dpl_AWnDMQiHDcn6LyaGnopUwMNiyPoP` and GCE immutable release `a5c2b60` now serve v2.30.0. GCE rollback points to `0ee87a7`; backup `lightning-20260820T190648Z.dump` is retained. Production Wallet Center, operator login, HTTP, capability and read-only SUN.io/LI.FI acceptance pass without wallet access, signing or broadcasting.
- Earlier code candidate `c670e31` passed Production CI run `32294819780`: secret scan, type check, 113 API tests, 199 Web tests, production build, high/critical dependency gate and both Docker image builds.
- Compatibility fix `111d279` passed Production CI run `32295696283`: credential scan, type check, 117 API tests, 199 Web tests, production build, production dependency gate and both Docker image builds.
- Candidate commit `184c5ea` passed 113 API tests, 192 Web tests, type checking, production build, CI, secret scanning, dependency gating and both Docker image builds.
- Candidate `5258b12` passed Production CI run `32347721319`: credential scan, type check, 117 API tests, 200 Web tests, production build, production dependency gate and both Docker image builds.
- Operations-hardening candidate `5be4e2e` passed Production CI run `32349813299`: production environment-gate tests, credential scan, type check, 117 API tests, 200 Web tests, production build, production dependency gate and both Docker image builds.
- Provider-approval preflight fix `01a7dc1` passed Production CI run `32350485348`: environment-gate tests, credential scan, type check, 117 API tests, 200 Web tests, production build, production dependency gate and both Docker image builds.
- Guarded rollback candidate `175caff` passed Production CI run `32351059019`: rollback-planner tests, environment-gate tests, credential scan, type check, 117 API tests, 200 Web tests, production build, dependency gate and both Docker image builds; the production `5258b12` → `184c5ea` Dry Run passed without state changes.
- MFA QR candidate `94c2b99` passed Production CI run `32372450835`: environment gate, rollback tests, credential scan, type check, 117 API tests, 202 Web tests, production build, dependency gate and both Docker image builds.
- SUN.io candidate `91397dd` passed local verification: 122 API tests, 209 Web tests, type check, default and mainnet-enabled web builds, production dependency gate, secret scan and both Docker image builds. A live read-only TRX/USDT quote returned three verified routes and the selected no-hook V4 route produced calldata without wallet access or broadcast.
- SUN.io candidate `91397dd` passed Production CI run `32376052339`; deployment-readiness fix `6bb8ddb` passed Production CI run `32377723421`, each including credential scanning, type checking, 122 API tests, 209 Web tests, production build, dependency gating and both Docker image builds.
- Version `2.21.0` candidate `6bb8ddb` is deployed to Vercel Production deployment `bbMhTpsFoAHHrcX7MwqMLRQr8BC7` and GCE release `/opt/lightning-wallet/releases/6bb8ddb`.
- Release `46c91aa` is the current server rollback point; database backup `lightning-20260820T135139Z.dump` was created before the v2.21 rollout.
- A production read-only TRX/USDT request returned HTTP 200 with three strictly validated SUN.io mainnet routes; no wallet, signature or broadcast was requested.
- Production HTTP acceptance, API/PostgreSQL/Redis readiness, host routing, CORS, zero-console-error browser checks and the `6bb8ddb` to `46c91aa` rollback Dry Run pass on v2.21.0.
- The initial v2.21 guarded rollout exposed a normal-startup readiness race in the acceptance step. No data was lost; `6bb8ddb` adds a bounded Docker health wait before external verification or rollback decisions.
- Live-provider acceptance commit `80da41e` passed Production CI run `32379623180`, was installed as the current immutable GCE operations release, returned three verified production SUN.io routes in 0.589 seconds, and passed the non-mutating rollback preflight to `6bb8ddb`.
- The production MFA encryption key and database schema are configured, while enrollment remains intentionally inactive until the operator confirms a live Authenticator code.
- Privacy-safe diagnostics candidate `300c66f` passed Production CI run `32381332282`: credential scanning, type checking, 126 API tests, 209 Web tests, production build, dependency gating and both Docker image builds.
- Vercel Production deployment `3B8sGdocX86uRhyRiMvKQCLGbaBG` and GCE immutable release `300c66f` now serve v2.22.0. GCE rollback points to `80da41e`, and both pre-deploy PostgreSQL backups are retained.
- Production acceptance passes for client/operator domain routing, API/PostgreSQL/Redis readiness, security headers, CORS, SUN.io read-only quotes and privacy-safe client diagnostics. The aggregate store contains one anonymous fingerprint with two acceptance occurrences; unauthenticated reads are rejected.
- LI.FI EVM Swap candidate `9a25a62` passed Production CI run `32385558905` with 135 API tests, 211 Web tests, type checking, secret and environment gates, production build, dependency gating and both Docker image builds.
- Vercel Production deployment `AHWpjUQPT4SBxBFgExnTCYUQNj3M` and GCE immutable release `9a25a62` now serve v2.23.0. GCE rollback points to `300c66f`, and both pre-deploy PostgreSQL backups are retained.
- Production browser acceptance returned a verified LI.FI/SushiSwap Ethereum USDC/WETH route with minimum output, price impact, Provider fee, estimated Gas and expiry. The live-provider gate also returned one verified LI.FI route and three verified SUN.io routes without wallet access, signing or broadcast.
- Launchpad candidate `2ef4d99` passed Production CI run `32389530988` with 156 API tests, 222 Web tests, type checking, secret/environment/rollback/provider gates, production build, production dependency gating and both Docker image builds.
- Vercel Production deployment `Cs4cZM6WQvDk1XSLssbVLrePqzrv` and GCE immutable release `2ef4d99` now serve v2.24.0. GCE rollback points to `9a25a62`; backup `lightning-20260820T160500Z.dump` is retained.
- Production browser acceptance verified all Launchpad network selectors, a validated but locked Ethereum Mainnet plan, `serverSigning: false`, and reload without a white screen. Mainnet transaction, Swap and Launchpad gates remain disabled; no wallet, signature or broadcast was requested.
- Wallet-provider candidate `81fbe4f` passed Production CI run `32392185721` with 156 API tests, 232 Web tests, type checking, secret/environment/rollback/provider gates, production build, production dependency gating and both Docker image builds.
- Vercel Production deployment `2Mf4TiaYJjzRXt31pzpqrkbqYkdc` and GCE immutable release `81fbe4f` now serve v2.25.0. GCE rollback points to `2ef4d99`; backup `lightning-20260820T163230Z.dump` is retained. Wallet Center production rendering/reload and the post-rollout read-only provider gate pass without wallet access, signing or broadcast.
- Batch-execution candidate `2f63ccd` passed Production CI run `32394511524` with 156 API tests, 239 Web tests, type checking, secret/environment/rollback/provider gates, production build, production dependency gating and both Docker image builds.
- Vercel Production deployment `4mh4js9UxuQuUTAY3ofFKqfethFY` and GCE immutable release `2f63ccd` now serve v2.26.0. GCE rollback points to `81fbe4f`; backup `lightning-20260820T165736Z.dump` is retained. Batch Transfer/Asset Collector rendering, default Dry Run, refresh and read-only provider verification pass without wallet access, signing or broadcast.
- Swap/Bridge hardening candidate `72e3a05` passed Production CI run `32396930066` with 156 API tests, 245 Web tests, type checking, secret/environment/rollback/provider gates, production build, production dependency gating and both Docker image builds.
- Vercel Production deployment `dpl_QgMnQ2qBZ9nPXadSeeh2h9v6zdXs` and GCE immutable release `72e3a05` now serve v2.27.0. GCE rollback points to `2f63ccd`; backup `lightning-20260820T173114Z.dump` is retained. Browser route/reload checks, HTTP acceptance and read-only SUN.io/LI.FI provider verification pass without wallet access, signing or broadcasting.
- Batch Trade/GasFree hardening candidate `f731e3f` passed Production CI run `32399958061` with 156 API tests, 259 Web tests, type checking, lint, credential/environment/rollback/provider gates, production build, dependency gating and both Docker image builds.
- Vercel Production deployment `dpl_oFwjke4cDrrV97dcMvVd5YJwynDD` and GCE immutable release `f731e3f` now serve v2.28.0. GCE rollback points to `72e3a05`; backup `lightning-20260820T180113Z.dump` is retained. Batch Trade/GasFree route/reload checks, HTTP acceptance and read-only SUN.io/LI.FI provider verification pass without wallet access, signing or broadcasting.
- Fail-closed readiness candidate `0ee87a7` passed Production CI run `32402823270` with 159 API tests, 262 Web tests, credential/environment/rollback/provider gates, type checking, production build, high/critical dependency gating and both Docker image builds.
- Vercel Production deployment `dpl_HCMLSg91z8aiFV8MrchtzdrRHMQR` and GCE immutable release `0ee87a7` now serve v2.29.0. GCE rollback points to `f731e3f`; backup `lightning-20260820T183054Z.dump` is retained. HTTP, browser route/reload and read-only provider acceptance pass while the final gate truthfully remains closed.

### Release gate

- This section is not a stable release and has no final mainnet approval.
- EVM, Solana and TRON Swap providers are implemented; all real Swap execution remains mainnet-flag and authorized-wallet acceptance gated. Sponsored GasFree and real Flash Loan logic remain provider/adapter gated; Launchpad still requires real-wallet testnet acceptance.
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
