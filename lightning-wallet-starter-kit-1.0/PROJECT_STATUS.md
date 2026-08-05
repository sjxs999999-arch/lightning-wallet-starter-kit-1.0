# Lightning Wallet Project Status

## Current stable release

- Version: `stable-v1.3-asset-collector`
- Branch: `stable/v1.0-deploy`
- Asset Collector implementation: `600e895`
- Status: Approved
- Build: PASS
- Docker: PASS
- Preview: `http://localhost:4173/collection`

## Completed milestones

- `stable-v1.0-local`: local frontend, API, PostgreSQL and Redis baseline
- `stable-v1.1-wallets`: EVM, Solana and TRON batch wallet generation
- `stable-v1.2-batch-transfer`: client-side multichain batch transfers
- `stable-v1.3-asset-collector`: client-side multichain asset scanning and collection

## Stable modules

- Dashboard and unified routing
- Multichain batch wallets
- Multichain batch transfers
- EVM, Solana and TRON Asset Collector
- CSV import and export
- Dry Run, Worker progress, pause, resume and failed-task retry
- Docker Compose, PostgreSQL and Redis

## Security boundary

- Private keys and mnemonics remain client-side.
- Sensitive material is not sent to the API, database or logs.
- Real transactions require explicit wallet confirmation and signature.
- Dry Run is enabled by default.
- RPC failures are isolated per task and do not cause a blank page.

## Development state

Development is stopped after Phase 4 approval. Swap, GasFree, Launchpad and other future modules remain out of scope until the next approved phase.
