# Lightning Wallet v2.27 production candidate

Version 2.27 extends the exact wallet, network and receipt guarantees from Batch Transfer/Asset Collector to Swap, Bridge and Launchpad without enabling any mainnet transaction flag.

## Included

- Sender-aware injected EVM, Solana and TRON wallet selection for Swap; Launchpad reuses authorized EVM provider discovery instead of preferring a fixed extension.
- Swap Solana RPC genesis attestation before wallet connection and confirmed-result validation after wallet broadcast.
- Strict EVM Swap receipt validation: failed, missing-status and timed-out receipts are never recorded as successful.
- A double production gate for Bridge (`VITE_MAINNET_EXECUTION_ENABLED` plus `VITE_ENABLE_MAINNET_BRIDGE`), enforced before wallet discovery.
- Bridge EVM chain/account revalidation after network switching and confirmed approval/bridge receipts.
- Bridge Solana Mainnet genesis attestation before signing and confirmed-result validation after broadcast.
- The complete official Solana Mainnet genesis value in the shared execution policy, replacing a truncated fingerprint that would have rejected the real Mainnet cluster.

## Safety boundary

- Mainnet transaction, Swap, Launchpad and Bridge flags remain disabled in production.
- No private key, mnemonic or seed phrase is requested, uploaded, logged or stored.
- All signing and broadcasting remains inside the user-selected browser wallet.
- Automated acceptance used public quote data only and did not request a wallet, signature or broadcast.

## Verification

- API: 156 tests passing across 32 files.
- Web: 245 tests passing across 60 files.
- Type check, production build, tracked-credential scan, environment/rollback/provider gates and API/Web Docker builds: PASS.
- Production dependency set: 0 high and 0 critical findings; 5 moderate transitive Solana/Jayson/UUID advisories remain without a safe non-breaking resolution.

## Production rollout

- Runtime commit: `72e3a05`.
- Production CI: `32396930066` — PASS.
- Vercel Preview: `https://lightning-wallet-lx61wu0f1-sjxs999999-archs-projects.vercel.app` — verified before promotion.
- Vercel Production: `dpl_QgMnQ2qBZ9nPXadSeeh2h9v6zdXs` (`https://lightning-wallet-864le98al-sjxs999999-archs-projects.vercel.app`) — Ready and current on `lightingwallet.com`.
- GCE current release: `/opt/lightning-wallet/releases/72e3a05`; rollback release: `/opt/lightning-wallet/releases/2f63ccd`.
- PostgreSQL backup retained: `lightning-20260820T173114Z.dump`.
- Production HTTP acceptance, API/PostgreSQL/Redis health, security headers, CORS and provider truthfulness: PASS.
- Production browser acceptance verified v2.27.0 across Bridge, Swap, Batch Transfer, Asset Collector and Launchpad, default Dry Run where applicable, default Sepolia Launchpad and refresh without a white screen; browser console errors: 0.
- Live-provider acceptance returned three SUN.io routes in 0.577436 seconds and one LI.FI route in 1.057013 seconds without wallet access, signing or broadcasting.
