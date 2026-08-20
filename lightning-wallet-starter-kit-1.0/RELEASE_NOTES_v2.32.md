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

- Unit, isolation, type, lint, production build, Docker, browser and deployment results are recorded after candidate validation.
