# Changelog

All notable stable Lightning Wallet releases are recorded here.

## stable-v1.3-asset-collector

### Added

- EVM, Solana and TRON wallet asset scanning.
- Native coin and configured token detection.
- Minimum-balance retention and automatic fee estimation.
- Client-side Dry Run and batch collection workflow.
- Worker-based scanning with realtime progress.
- Pause, resume, failed-task retry, session logs and CSV result export.
- BigInt fixed-point collection calculations.

### Security

- Private keys and mnemonics remain outside the API, database and logs.
- Real collection transactions require wallet confirmation and signature.
- Sensitive CSV fields are rejected.
- Individual RPC failures are isolated without blanking the page.

### Verification

- Implementation commit: `600e895`
- Asset Collector tests: 6/6 PASS
- 1,000-task planning performance: approximately 28 ms
- Production build: PASS
- Docker build and local Preview: PASS

## stable-v1.2-batch-transfer

- Added EVM, Solana and TRON batch transfers.
- Added CSV templates, validation, Dry Run, progress, pause/resume, retry and result export.

## stable-v1.1-wallets

- Added client-side EVM, Solana and TRON batch wallet generation.
- Added public CSV and encrypted JSON export.

## stable-v1.0-local

- Established the verified local frontend, API, PostgreSQL, Redis and Docker baseline.
