# Lightning Wallet v2.0 Stable Release

## Release identity

- Tag: `stable-v2.0-lightning-wallet`
- Stable branch: `stable/v1.0-deploy`
- Automation Center implementation: `59a2395`
- Status: Approved stable release

## Overview

Lightning Wallet v2.0 combines the verified multichain wallet and operations modules into one deployable React, TypeScript, Node.js, PostgreSQL, Redis and Docker Compose platform. The release adds a read-only Automation Center while preserving the established client-side key boundary and no-white-screen error handling.

## Included modules

- Dashboard and unified authenticated routing
- EVM, Solana and TRON batch wallet generation
- Multichain batch transfers and Asset Collector
- Multichain Swap aggregation and local history
- Existing Flash Loan application integration
- GasFree estimation and sponsorship abstraction
- Multichain Token Launchpad
- PostgreSQL-backed Project Center
- Read-only multichain Market Center
- Automation Center, notification channels, health monitor, retry queue and job history

## Automation Center

- Persistent scheduler rules for price, watchlist, portfolio, Gas and health monitoring
- Telegram, Email and signed HTTPS Webhook adapters
- Notification Dry Run and masked destinations
- Thirty-second service health refresh
- PostgreSQL job history and failed-job retry support
- Real notification delivery disabled until explicitly configured by an operator

## Security boundaries

- Private keys and mnemonics remain in the client and are not sent to the API, database or logs.
- The Automation and Market Centers do not sign or broadcast transactions.
- Real wallet operations require explicit user-wallet confirmation and signature.
- Automation monitoring is read-only by default.
- Notification credentials remain in server environment variables.
- Mainnet execution remains subject to each module's explicit configuration and safety controls.

## Verification

- Automation API and web tests: 70/70 PASS
- Type check: PASS
- Production build: PASS
- Docker API and Web builds: PASS
- PostgreSQL and Redis health: PASS
- Automation scheduler and persistence: PASS
- Authentication, destination masking and notification Dry Run: PASS
- Preview route reload and error isolation: PASS

## Local preview

- Web: `http://localhost:4173`
- Automation Center: `http://localhost:4173/automation`
- API: `http://localhost:3001`
- Health: `http://localhost:3001/health`

## Configuration required for external services

- Market holder counts require a trusted read-only holder-data provider.
- Real Telegram delivery requires `TELEGRAM_BOT_TOKEN`.
- Real Email delivery requires `EMAIL_PROVIDER_URL` and `EMAIL_API_KEY`.
- Real Webhook delivery requires `WEBHOOK_SIGNING_SECRET`.
- Real notification delivery additionally requires `AUTOMATION_ENABLE_DELIVERY=true`.

No external delivery is enabled by the stable default configuration.
