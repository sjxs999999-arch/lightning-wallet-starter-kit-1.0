# Lightning Wallet v2.33 production candidate

Version 2.33 adds a read-only, testnet-first asset view to the encrypted local Wallet Center. It reuses the existing network-attested Asset Collector scanner and does not enable a mainnet execution gate.

## Added

- On-demand native and Token balance display for EVM Sepolia, Solana Devnet and TRON Nile/Shasta.
- Solana SPL Token and Token-2022 discovery through standard public RPC methods.
- EVM ERC-20 and TRON TRC-20 balance display for locally registered custom Token contracts.
- Exact testnet attestation before any balance request.
- Bounded custom-Token concurrency, a 50-contract limit and manual refresh to reduce public RPC rate limiting.
- Panel-local RPC errors and stale-response suppression so switching wallets or a failed provider cannot blank the page.
- Lazy-loaded portfolio UI and scanner code so Wallet Center startup remains small.

## Security boundary

- The feature is read-only and sends only public wallet addresses and public Token contracts directly to the selected testnet RPC.
- It never unlocks the vault, decrypts a private key, requests a signature, calls the API with secret material or broadcasts a transaction.
- Corrupted, duplicate, unrelated or excessive public Token metadata is skipped and reported locally.
- Mainnet batch transfer, asset collection, Swap, Launchpad and Bridge gates remain disabled.

## Verification status

- Runtime, CI, browser, Preview and production deployment results will be recorded after candidate validation.
