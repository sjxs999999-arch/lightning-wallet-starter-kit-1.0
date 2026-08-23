# Lightning Wallet v2.36 production release

Version 2.36 strengthens no-white-screen recovery and production deployment safety. It adds no wallet feature, changes no transaction approval policy and enables no mainnet gate.

## Changed

- Added an inner error boundary around every lazy client and operator route.
- A failed route now renders a recovery panel inside the existing shell, preserving navigation, reload and a safe-entry action.
- Raised the production free-space requirement from 8 GiB to 20 GiB and added boundary regression coverage.
- Production deploys remove only unused Docker build cache before checking capacity.
- Added a guarded forward-promotion script that keeps the verified release at `current` until the target passes Docker health and external production acceptance.
- Pre-created rollback recovery links before changing `current`, making recovery resilient to a target build that exhausts free space.

## Security boundary

- Private keys and mnemonics remain local to the browser or wallet extension.
- The API reports `serverSigning: false` and `serverBroadcast: false`.
- All mainnet execution, Swap, Launchpad and Bridge gates remain disabled.
- Final approval remains blocked on WalletConnect, GasFree Paymaster, market holder data, a real Flash Loan application/API, an automation delivery provider and authorized real-wallet signing acceptance.

## Verification status

- Code commit `17547ea` passes 161 API tests and 303 Web tests across 112 test files.
- Type checking, lint, production build, secret scan, environment/verification gates and local API/Web Docker builds pass.
- Operations commit `8606a31` adds disk and promotion regression tests; Production CI run `32665450196` passes both verify and Docker jobs. Code CI run `32664550487` also passes.
- The production dependency gate reports no high or critical production advisory; currently unresolved upstream findings are moderate only.
- Vercel Preview `2xhnLKxsEVcG4pKXzv5yqZgBSnTc` and Production `85S7WEnKGfaZhKSVSSm9iusAqmbz` are Ready and serve web v2.36.0.
- Production browser acceptance verified `lightingwallet.com/wallets` first load and forced reload, persistent navigation, no route failure and zero console errors. `admin.lightingwallet.com/settings` redirects unauthenticated users to the isolated operator login.
- GCE immutable release `8606a31` serves API/Web v2.36.0; rollback points to `94d3b5e`, and backup `/opt/lightning-wallet/backups/lightning-20260823T205044Z.dump` is retained.
- API, Web, PostgreSQL and Redis are healthy. HTTPS, security headers, CORS, capability truthfulness and metadata-only diagnostic acceptance pass.
- Final readiness exits blocked on exactly the five declared external providers, authorized-wallet signing acceptance and all four disabled mainnet gates.

## Deployment incident closure

The first v2.36 GCE image build stopped during API image unpack because the former 8 GiB disk threshold was too low. The running v2.35 containers and database remained healthy, `current` was restored to `94d3b5e`, and 17.9 GiB of unused BuildKit cache was reclaimed. Release `8606a31` then passed the new 20 GiB preflight and completed with a fresh PostgreSQL backup and 21 GiB free after rollout.
