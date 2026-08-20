# Lightning Wallet v2.25 production candidate

Version 2.25 hardens the existing non-custodial Wallet Center without enabling any mainnet transaction path.

## Included

- EVM provider discovery through EIP-6963, with exact Sepolia switching, post-switch chain revalidation, checksum-normalized accounts and a second account/network check immediately before a self-test signature.
- Solana Devnet validation using the complete genesis hash before wallet connection and again before a self-test transaction.
- Exact official Nile/Shasta TRON RPC hostname checks, Base58Check address validation, active-account revalidation and confirmed receipt status enforcement.
- OKX Wallet connection entries for EVM, Solana and TRON alongside MetaMask, WalletConnect, Rabby, Phantom, Backpack, Solflare and TronLink.
- Random, timestamped ownership challenges generated in browser memory and metadata-only public history.

## Safety boundary

- All self-test transactions remain testnet-only; mainnet transaction, Swap and Launchpad gates remain disabled.
- No private key or mnemonic is read, sent, persisted or logged.
- A wallet rejection, network mismatch, account change, failed receipt or confirmation timeout fails closed and is never recorded as success.
- Wallet signing remains an explicit extension/mobile-wallet action; the API cannot sign or broadcast.

## Local verification

- API: 156 tests passing across 32 files.
- Web: 232 tests passing across 60 files, including 13 focused wallet-provider/history tests.
- Type check, production build, credential scan, environment-gate tests, provider fixtures and API/Web Docker builds: PASS.
- Production dependency set: 0 high and 0 critical findings; 6 moderate transitive SUN/Solana/Jayson/UUID advisories have no current upstream fix.

## Production rollout

- Runtime commit: `81fbe4f`.
- Production CI: `32392185721` — PASS.
- Vercel Preview: `https://lightning-wallet-iqe3l5ukq-sjxs999999-archs-projects.vercel.app` — verified before promotion.
- Vercel Production: `2Mf4TiaYJjzRXt31pzpqrkbqYkdc` (`https://lightning-wallet-82kftp0qp-sjxs999999-archs-projects.vercel.app`) — Ready and current on `lightingwallet.com`.
- GCE current release: `/opt/lightning-wallet/releases/81fbe4f`; rollback release: `/opt/lightning-wallet/releases/2ef4d99`.
- PostgreSQL backup retained: `lightning-20260820T163230Z.dump`.
- Production HTTP acceptance, API/PostgreSQL/Redis health, security headers, CORS and provider truthfulness: PASS.
- Production browser acceptance verified all ten provider entry points, v2.25.0, OKX Solana/TRON visibility and refresh without a white screen.
- Live-provider acceptance returned three SUN.io routes in 0.503863 seconds and one LI.FI route in 1.785241 seconds without wallet access, signing or broadcast.
- Mainnet transaction, Swap and Launchpad flags remain disabled.
