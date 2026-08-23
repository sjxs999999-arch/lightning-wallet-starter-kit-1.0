# Lightning Wallet v2.35 production candidate

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

- 161 API tests and 301 Web tests pass, including new static regression coverage for both retired relay implementations.
- Type checking, lint, production build, secret scan, environment gate, rollback tests and live-provider fixtures pass.
- API and Web Docker image builds pass.
- Official production dependency audit reports five moderate upstream findings and no high or critical vulnerability; no forced breaking dependency upgrade was applied.
- CI and production rollout acceptance remain required before v2.35 is marked deployed.
