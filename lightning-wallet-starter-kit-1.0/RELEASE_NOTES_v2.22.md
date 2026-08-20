# Lightning Wallet v2.22 production candidate

Version 2.22 closes the client crash-reporting gap without adding a third-party tracking service.

## Included

- Public client error reports now accept only error name, fixed code, public route, anonymous 96-bit fingerprint and release number.
- Error messages, component stacks, private keys, mnemonics and arbitrary fields are rejected by strict schemas.
- Reports are rate-limited to 20 requests per minute per source and aggregated by fingerprint, release and route.
- Aggregates are stored in PostgreSQL, pruned after 90 inactive days and exposed only to an authenticated operator.
- The Security Center shows occurrence count, first seen and last seen without displaying error text or wallet identity.
- Prometheus exposes only the accepted-report counter behind the existing protected metrics endpoint.
- Production acceptance proves anonymous writes succeed and unauthenticated reads fail.

## Safety boundary

This module does not use analytics cookies, a device identifier or a third-party Crash Reporting DSN. It never receives a wallet address, signature, transaction payload or secret material.

Mainnet execution and mainnet Swap flags remain disabled.
