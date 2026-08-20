# Lightning Wallet v2.29 production candidate

Version 2.29 makes production readiness explicit and fail-closed across the Fastify API, the Vercel fallback API, the client and the operator console. It does not enable any mainnet execution flag and is not final mainnet approval.

## Included

- Added one public, privacy-safe capability contract shared by the production surfaces, including release version, module status, security invariants and final-readiness state.
- Added exactly five external-provider blockers: WalletConnect Project ID, GasFree Paymaster, holder-data provider, real Flash Loan application/API and Automation delivery provider.
- Added a separate wallet-signing acceptance gate and explicit global, Swap, Launchpad and Bridge mainnet states.
- Replaced the stale Vercel fallback response that required an operator session and incorrectly reported every module as ready.
- Added visible final-readiness panels to the non-custodial client and System Settings without making the UI dependent on the new response during a staggered rollout.
- Added a production invariant verifier and a stricter final-readiness verifier that cannot pass until providers, wallet acceptance and every mainnet gate are complete.
- Production preflight now rejects any mainnet flag unless `FINAL_WALLET_ACCEPTANCE_APPROVED=true` and the strict external-provider gate is enabled.

## Safety boundary

- Mainnet transaction, Swap, Launchpad and Bridge flags remain disabled in production.
- No automated acceptance connected a wallet, requested a signature or broadcast a transaction.
- Private keys, mnemonics and seed phrases remain outside the API, database, logs and Git.
- The final-readiness gate is intentionally failing with five external dependencies plus authorized wallet acceptance still outstanding.

## Verification

- API: 159 tests passing across 33 files.
- Web: 262 tests passing across 64 files.
- Type check, ESLint, production build, tracked-credential scan, environment/rollback gates, final-readiness fixture and API/Web Docker builds: PASS.
- Production dependency set: 0 high and 0 critical findings; 6 moderate transitive Solana/SUN SDK advisories remain without a safe non-breaking resolution.
- Production CI `32402823270`: PASS.

## Production rollout

- Runtime commit: `0ee87a7`.
- Vercel Preview: `dpl_AdVnJG2TfdzKtHLic1axd3yWTcbr` (`https://lightning-wallet-2prmvbux3-sjxs999999-archs-projects.vercel.app`) — READY.
- Vercel Production: `dpl_HCMLSg91z8aiFV8MrchtzdrRHMQR` (`https://lightning-wallet-dwkryvccb-sjxs999999-archs-projects.vercel.app`) — READY on `lightingwallet.com` and `admin.lightingwallet.com`.
- GCE current release: `/opt/lightning-wallet/releases/0ee87a7`; rollback release: `/opt/lightning-wallet/releases/f731e3f`.
- PostgreSQL backup retained: `lightning-20260820T183054Z.dump`.
- Guarded GCE rollout completed in 261 seconds with database state preserved and all containers healthy.
- Production HTTP, API/PostgreSQL/Redis, security-header, CORS and capability-truthfulness acceptance: PASS.
- Browser acceptance verified v2.29.0 on Client Home, System Settings and the operator login page, including refresh without a white screen and zero page/console errors.
- Live-provider acceptance returned three SUN.io routes in 0.982454 seconds and one LI.FI route in 1.329529 seconds without wallet access, signing or broadcasting.
- The strict external-provider gate fails on exactly five required integrations, while the final-readiness endpoint also reports wallet acceptance pending and all mainnet switches off.
