# Lightning Wallet v2.35 production release

Version 2.35 closes the last server-side signed-transaction relay. It adds no wallet feature, changes no transaction UI and does not enable any mainnet gate.

## Changed

- The legacy authenticated `POST /api/v1/solana/send-signed-batch` route now returns permanent HTTP 410 in Fastify and Vercel.
- The server no longer accepts, stores or forwards signed Solana transaction payloads.
- The capability contract explicitly reports `serverSigning: false` and `serverBroadcast: false`.
- Existing client behavior is preserved: the authorized wallet signs locally and the browser broadcasts directly to the attested RPC only after user confirmation.

## Security boundary

- Private keys and mnemonics remain local to the browser or extension.
- The server cannot sign or broadcast a transaction.
- Transaction payloads are not accepted by the retired relay.
- All mainnet execution, Swap, Launchpad and Bridge gates remain disabled.
- Final approval remains blocked on exactly five external providers plus authorized real-wallet signing acceptance.

## Verification status

- Commit `be7739a` passes 161 API tests and 301 Web tests, including new static regression coverage for both retired relay implementations.
- Type checking, lint, production build, secret scan, environment gate, rollback tests and live-provider fixtures pass.
- API and Web Docker image builds pass.
- Official production dependency audit reports five moderate upstream findings and no high or critical vulnerability; no forced breaking dependency upgrade was applied.
- Production CI run `32661563834` passed.
- Vercel Preview `CEUX8cctop8DQvRrdmfPMNGfsdva` and Production `43YipHuZ1SU3VnepKt83Bnj78ia3` are Ready and serve v2.35.0.
- GCE immutable release `be7739a` serves API v2.35.0; rollback points to `3883c04`, and backup `/opt/lightning-wallet/backups/lightning-20260823T194024Z.dump` is retained.
- Production HTTP, CORS, security headers, PostgreSQL, Redis and browser route/reload acceptance pass. The client shows both server signing and server broadcasting closed, while the unauthenticated operator route redirects to login; browser console errors are zero.
- Read-only provider acceptance returned three verified SUN.io routes in 0.398882 seconds and one verified LI.FI route in 0.765091 seconds without wallet access, signing or broadcast.
- Final readiness remains fail-closed on exactly five external providers, authorized-wallet signing acceptance and all four disabled mainnet gates.
