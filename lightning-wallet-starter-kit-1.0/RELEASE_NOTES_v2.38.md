# Lightning Wallet v2.38 production release

Version 2.38 makes authorized-wallet acceptance evidence verifiable against the public test networks before any production approval can be enabled. It adds no wallet feature, performs no wallet transaction and enables no mainnet gate.

## Changed

- Added `scripts/verify-wallet-acceptance-live.sh` to verify the public transaction references already required by the offline acceptance report.
- Requires Sepolia Chain ID `0xaa36a7`, successful mined EVM receipts and exact transaction-hash matches.
- Requires the exact Solana Devnet genesis fingerprint plus confirmed or finalized signatures with no transaction error.
- Requires the official TRON Nile endpoint, successful transaction results, matching transaction IDs, confirmed blocks and successful receipts.
- Rejects acceptance reports older than 30 days or dated more than five minutes in the future.
- Production preflight reruns the offline structure/SHA verifier and live public-chain verifier whenever `FINAL_WALLET_ACCEPTANCE_APPROVED=true` is requested.
- Added deterministic mock-RPC fixtures covering valid evidence plus wrong-chain, failed, unconfirmed, stale and future-dated failure modes.

## Security boundary

- The live verifier reads only public transaction references and public RPC responses; it does not connect to a wallet, request a signature or broadcast a transaction.
- Private keys, mnemonics and signed transaction payloads remain outside the API, database, logs and repository.
- The API continues to report `serverSigning: false` and `serverBroadcast: false`.
- Mainnet execution, Swap, Launchpad and Bridge remain disabled.
- Final approval remains blocked on the five declared external providers and evidence-backed acceptance performed with authorized real wallets.

## Verification status

- Commit `3f49830` passes 161 API tests and 303 Web tests across 112 test files (464 total).
- Type checking, lint, production build, secret scan, environment/disk/promotion/rollback/verification/provider gates and local API/Web Docker builds pass.
- Production dependency audit reports no high or critical production advisory; five moderate upstream advisories remain without a safe compatible fix.
- Production CI run `32677660667` passes both verification and Docker jobs.
- Vercel Preview `9RJa4S9takB99VaDQN4WMZBWmmpB` and Production `C83JvbNjFtmgqiwaZyViXfJHYycy` are Ready and serve web v2.38.0. The production deployment URL is `https://lightning-wallet-r6roukncp-sjxs999999-archs-projects.vercel.app`.
- Browser acceptance verified `https://lightingwallet.com/wallets` first load and reload, visible v2.38.0, no white screen and zero console warnings/errors. `https://admin.lightingwallet.com/settings` redirects unauthenticated users to the isolated operator login with zero console warnings/errors.
- GCE immutable release `3f49830` serves API/Web v2.38.0 after backup `/opt/lightning-wallet/backups/lightning-20260824T115800Z.dump`; rollback points to `de1ba48`.
- API, Web, PostgreSQL, Redis and proxy containers are healthy; 21 GiB remains available. Public HTTPS, security headers, CORS, API/PostgreSQL/Redis readiness, capability truthfulness and privacy-safe diagnostics pass.
- Final readiness exits blocked on exactly `WALLETCONNECT_PROJECT_ID`, `GASFREE_PAYMASTER`, `MARKET_HOLDER_PROVIDER`, `FLASH_LOAN_APPLICATION` and `AUTOMATION_DELIVERY_PROVIDER`, plus evidence-backed authorized-wallet acceptance. All four mainnet gates remain false.
