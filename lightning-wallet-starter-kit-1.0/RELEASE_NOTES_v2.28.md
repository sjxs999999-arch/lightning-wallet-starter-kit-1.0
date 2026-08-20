# Lightning Wallet v2.28 production candidate

Version 2.28 closes the remaining internally actionable wallet-selection, network-attestation and receipt-state gaps in Solana Batch Trade and the Sepolia GasFree top-up path. It does not enable any mainnet execution flag.

## Included

- Solana Batch Trade now requires both the global mainnet gate and the Swap-specific mainnet gate before RPC or wallet discovery.
- The Batch Trade executor attests the exact Solana Mainnet genesis, selects the injected wallet matching the intended public sender, and verifies the serialized transaction payer before asking for confirmation.
- Solana broadcast results are separated into confirmed, submitted/confirmation-unavailable and definitively failed states so users are warned not to duplicate an ambiguous broadcast.
- GasFree Sepolia top-up now uses sender-aware EVM provider discovery instead of preferring OKX Wallet, validates the exact Sepolia chain, estimates Gas and rechecks the active account before broadcast.
- GasFree top-up records exact successful, submitted and failed receipt states; a failed receipt is never shown as success.
- LP Manager was audited and remains read-only locally, delegating any wallet action to official protocol applications.

## Safety boundary

- Mainnet transaction, Swap, Launchpad and Bridge flags remain disabled in production.
- No automated acceptance connected a wallet, requested a signature or broadcast a transaction.
- Private keys, mnemonics and seed phrases remain outside the API, database, logs and Git.
- Real signing remains inside the user-selected browser wallet and still requires final authorized wallet acceptance.

## Verification

- API: 156 tests passing across 32 files.
- Web: 259 tests passing across 62 files.
- Type check, ESLint, production build, tracked-credential scan, environment/rollback gates and API/Web Docker builds: PASS.
- Production dependency set: 0 high and 0 critical findings; 5 moderate transitive Solana/Jayson/UUID advisories remain without a safe non-breaking resolution.

## Production rollout

- Runtime commit: `f731e3f`.
- Production CI: `32399958061` — PASS.
- Vercel Preview: `dpl_6Nk9FKXNQxRg7FZ36vFrc3wt88Ls` (`https://lightning-wallet-dbd81n78z-sjxs999999-archs-projects.vercel.app`) — READY and verified through protected deployment access.
- Vercel Production: `dpl_oFwjke4cDrrV97dcMvVd5YJwynDD` (`https://lightning-wallet-3z0t8cdt0-sjxs999999-archs-projects.vercel.app`) — READY on `lightingwallet.com` and `admin.lightingwallet.com`.
- GCE current release: `/opt/lightning-wallet/releases/f731e3f`; rollback release: `/opt/lightning-wallet/releases/72e3a05`.
- PostgreSQL backup retained: `lightning-20260820T180113Z.dump`.
- Production HTTP, API/PostgreSQL/Redis, security-header, CORS and provider-truthfulness acceptance: PASS.
- Production browser acceptance verified v2.28.0 on Batch Trade and GasFree, including refresh without a white screen, zero console errors, GasFree mainnet-off/Dry-Run state and no wallet access.
- Live-provider acceptance returned three SUN.io routes in 0.597616 seconds and one LI.FI route in 0.736660 seconds without wallet access, signing or broadcasting.
- The strict external-provider gate remains closed on exactly five prerequisites: WalletConnect Project ID, GasFree Paymaster, holder-data provider, real Flash Loan application/API and Automation delivery configuration.
