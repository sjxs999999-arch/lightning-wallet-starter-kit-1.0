# Lightning Wallet v2.32 production candidate

Version 2.32 extends the encrypted local Wallet Center session into the existing Batch Transfer and Asset Collector modules. It remains testnet-only and does not enable any mainnet execution gate.

## Added

- Client-tab wallet-vault session shared across Wallet Center, Batch Transfer and Asset Collector.
- Fifteen-minute inactivity lock, immediate manual/page-exit lock, and session-key invalidation checks before signing and before broadcast.
- EVM Sepolia, Solana Devnet and TRON Nile/Shasta local-vault execution in existing batch-transfer flows.
- EVM Sepolia, Solana Devnet and TRON Nile/Shasta local-vault execution in existing asset-collection flows.
- Local-vault asset scanning uses separate testnet RPC settings, validates EVM Chain ID / Solana Genesis / official TRON host before reading balances, and throttles scan concurrency to reduce public-RPC rate limits.
- One explicit batch confirmation followed by sequential one-shot Worker signing; no repeated extension-wallet clicks.
- Pause, resume, retry, progress and existing public-only audit history remain in the original modules.
- Actual testnet fee planning is refreshed immediately before each signature.

## Security boundary

- Private keys remain AES-256-GCM ciphertext in the browser vault.
- Decryption occurs only inside a one-shot Web Worker.
- The main thread receives only signed transaction payloads; no plaintext private key or mnemonic enters React state, API, database, logs or Git.
- Locking the vault invalidates the session synchronously. A transaction signed after the lock boundary is not broadcast.
- Mainnet batch transfer, asset collection, Swap, Launchpad and Bridge gates remain disabled.

## Verification status

- Runtime commit: `11c252f`.
- API: 159 tests passing across 33 files.
- Web: 288 tests passing across 73 files, including address matching, one-shot local signing and lock-after-sign/no-broadcast isolation.
- Type checking, lint, production build, credential scan, environment/rollback/provider gates and both local Docker image builds: passing.
- Production dependency gate: zero high or critical advisories; six moderate transitive advisories remain without a compatible upstream fix.
- Production CI run `32413522190`: passing, including verification and Docker jobs.
- Vercel Preview `dpl_Hv7YYB8LwCwfrVcbHVHBFkmTdtfQ`: ready.
- Vercel Production `dpl_CfmzuANq3dFYR9JsimGXYCkZdnDi`: ready on `lightingwallet.com` and `admin.lightingwallet.com`.
- GCE immutable release: `/opt/lightning-wallet/releases/11c252f`; rollback: `/opt/lightning-wallet/releases/5963902`; retained pre-deploy backup: `lightning-20260820T202520Z.dump`.
- Production browser checks pass for client/operator separation, Batch Transfer and Asset Collector routes, shared-vault UI and refresh locking without a white screen.
- Production HTTP, CORS, security-header, API/PostgreSQL/Redis and read-only Provider acceptance pass. SUN.io returned three routes in 0.691128 seconds; LI.FI returned one route in 0.942622 seconds.
- No automated acceptance connected a wallet, requested a signature or broadcast a transaction. Authorized real-wallet acceptance remains required.
- Final approval remains fail-closed on exactly five external-provider prerequisites, wallet acceptance and four disabled mainnet gates.
