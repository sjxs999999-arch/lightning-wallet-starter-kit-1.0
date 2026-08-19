# Lightning Wallet production status

Updated: 2026-08-19

## Candidate baseline

- Development branch: `codex/final-production`
- Latest candidate commit: see `git log -1 --oneline`
- Last approved historical tag: `stable-v2.0-lightning-wallet`
- Client domain: `https://lightingwallet.com`
- Operator domain: `https://admin.lightingwallet.com`
- API domain: `https://api.lightingwallet.com`
- Final production approval: **not issued**

The historical v2.0 tag is retained for rollback. It is not evidence that every transaction module is production-approved.

## Capability matrix

| Module | Implementation | Current production gate |
|---|---|---|
| Client/operator domain split | Complete | Latest candidate still needs production promotion |
| Wallet providers | MetaMask, WalletConnect, OKX, Rabby, Phantom, Backpack, Solflare, TronLink | Testnet acceptance complete in code; final manual extension acceptance remains |
| Batch Wallet | Local EVM/Solana/TRON generation, Worker execution, encrypted JSON/CSV export, control verification | Implemented; never uploads secret material |
| Batch Transfer | EVM/Solana/TRON planning, CSV validation, Dry Run, progress, retry and wallet signing | Mainnet feature flag is off; final chain-specific acceptance required |
| Asset Collector | EVM/Solana/TRON scanning/planning, reserve rules, Dry Run and wallet signing | Mainnet feature flag is off; final chain-specific acceptance required |
| Swap | Provider availability endpoint, quote Worker, route/impact guards, exact approval and wallet signing | Solana/Jupiter available; EVM needs `ZEROX_API_KEY`; TRON needs `TRON_SWAP_PROVIDER_URL`; mainnet flag off |
| Flash Loan | Isolated Sepolia session bridge and built-in no-broadcast compatibility shell | Referenced historical repository contains no completed Flash Loan app; real integration is blocked on an actual provider application/API |
| GasFree | Sepolia estimates, VIP policy, Paymaster abstraction, top-up planning and user-wallet signing | Sponsored transactions blocked until an approved Paymaster URL is configured |
| Launchpad | Validated multichain token plans, local media validation, liquidity planning and wallet signature request | Real EVM/Solana/TRON deployment adapters are not approved |
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
- Optional RFC 6238 TOTP support is implemented but must not be enabled before authenticator enrollment.
- Structured logs redact credentials, tokens, cookies and wallet secret fields.
- PostgreSQL backup, guarded restore, readiness checks and rollback release layout are included.
- CI runs type checking, tests, production build and Docker image builds.

## Current verification baseline

- API tests: 104 passing.
- Web tests: 168 passing.
- Type check: passing.
- Production build: passing.
- Latest completed CI before this status update: passing; every subsequent commit must pass again before promotion.
- Production dependency audit: 0 critical, 0 high, 3 moderate transitive Solana/Jayson/UUID advisories. No unsafe downgrade is applied.

## Required before final approval

1. CI and Vercel Preview must pass for the exact candidate commit.
2. Deploy the same API commit to the protected GCE release directory and verify health/readiness/metrics.
3. Promote the exact web candidate to both production domains and verify route isolation plus security headers.
4. Enroll the operator authenticator before enabling `ADMIN_TOTP_SECRET`.
5. Configure and verify any external provider being claimed: 0x, TRON Swap, Paymaster, notification delivery and a real Flash Loan app.
6. Perform authorized testnet then limited-mainnet wallet acceptance for EVM, Solana and TRON, recording public transaction hashes only.
7. Run the final browser → API → database → provider regression and rollback drill.

Until those gates pass, the product must be described as a production candidate and not as fully mainnet-approved.
