# Lightning Wallet v2.37 production release

Version 2.37 makes authorized wallet acceptance auditable. It adds no wallet feature, changes no transaction approval policy, performs no wallet transaction and enables no mainnet gate.

## Changed

- Added `scripts/verify-wallet-acceptance.sh`, a fail-closed verifier for production wallet acceptance evidence.
- Requires all ten declared wallet provider/network paths to pass connect, sign, broadcast, confirmation and browser-reload history checks.
- Requires EVM, Solana and TRON wallet-rejection, RPC-failure and route-failure tests to prove no broadcast and no white screen.
- Requires public chain transaction references with chain-specific validation, without duplicate provider paths or duplicate same-chain references.
- Requires the evidence file and its exact SHA-256 digest to be configured together; the report path must be absolute.
- Rejects a bare `FINAL_WALLET_ACCEPTANCE_APPROVED=true`, pending reports, modified reports, test-only evidence and any report that permits private-key upload, mnemonic upload, server signing or server broadcast.
- Added a safe production template plus a test-only positive fixture and executable positive/negative regression coverage.

## Security boundary

- The repository contains no real wallet acceptance result and does not pretend that one exists.
- Private keys and mnemonics remain local to the browser or wallet extension.
- The API reports `serverSigning: false` and `serverBroadcast: false`.
- All mainnet execution, Swap, Launchpad and Bridge gates remain disabled.
- Final approval remains blocked on WalletConnect, GasFree Paymaster, market holder data, a real Flash Loan application/API, an automation delivery provider and evidence-backed authorized real-wallet acceptance.

## Verification status

- Commit `de1ba48` passes 161 API tests and 303 Web tests across 112 test files.
- Type checking, lint, production build, secret scan, environment/disk/promotion/rollback/verification/provider gates and local API/Web Docker builds pass.
- The wallet-acceptance test proves that the test fixture passes only in the test environment, while the pending production template and a mismatched digest fail closed.
- Production CI run `32666992683` passes both verification and Docker jobs.
- The production dependency audit reports no high or critical production advisory; the remaining upstream findings are moderate and have no available fix.
- Vercel Preview `8nCWVkjFbqXKLzgnFzJaswVDky8w` and Production `G2zXk4vbGaw4qePrYtsVEaWTdyFr` are Ready and serve web v2.37.0.
- GCE immutable release `de1ba48` serves API/Web v2.37.0 after backup `/opt/lightning-wallet/backups/lightning-20260823T212058Z.dump`; the prior verified release is `8606a31`.
- Production browser acceptance verified `lightingwallet.com/wallets` first load and reload, visible v2.37.0, no route failure and zero console errors. `admin.lightingwallet.com/settings` redirects unauthenticated users to the isolated operator login with zero console errors.
- HTTPS, security headers, CORS, API/PostgreSQL/Redis readiness, capability truthfulness and metadata-only diagnostic acceptance pass.
- Final readiness remains blocked on exactly the five declared external providers, evidence-backed authorized-wallet acceptance and all four disabled mainnet gates.
