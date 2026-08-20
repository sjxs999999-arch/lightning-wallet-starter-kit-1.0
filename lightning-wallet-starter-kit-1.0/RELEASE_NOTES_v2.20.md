# Lightning Wallet v2.20 production candidate

Released: 2026-08-20

## Immutable release

- Source commit: `5258b12`
- Functional Launchpad RPC-isolation commit: `fc66218`
- Production CI: `32347721319`
- Vercel deployment: `HRZfYMQyjxDNjEdB3VWh1cKAvnGf`
- GCE release: `/opt/lightning-wallet/releases/5258b12`
- Server rollback: `/opt/lightning-wallet/releases/184c5ea`
- Pre-deploy database backup: `lightning-20260820T081545Z.dump`

## Production surfaces

- Client: `https://lightingwallet.com`
- Operator: `https://admin.lightingwallet.com`
- API: `https://api.lightingwallet.com`

The client is non-custodial and wallet-first. The operator console remains a separate authenticated hostname. The API reports version `2.20.0` and does not accept wallet private keys or mnemonics.

## Added and hardened

- Client-built fixed-supply ERC-20 deployment on Sepolia.
- Client-built fixed-supply SPL Token mint on Solana Devnet, followed by mint-authority revocation.
- Client-built fixed-supply TRC-20 deployment on TRON Nile using the checksum-pinned official TRON Solidity compiler artifact.
- Explicit wallet confirmation, network guards, fee disclosure, confirmation polling and explorer links.
- Browser-local public project/deployment history; no key material is uploaded.
- Vercel Serverless Launchpad validation with strict public-field schemas and no server signing or broadcasting.
- Dedicated `VITE_LAUNCHPAD_SOLANA_RPC_URL`, isolated from the Solana Mainnet RPC used by batch transfer and asset collection.

## Verification

- API tests: 117/117.
- Web tests: 200/200.
- Type check and production build: pass.
- API and Web Docker builds: pass.
- Production high/critical dependency gate: pass.
- Vercel Preview and Production: ready.
- Client home, batch transfer, Launchpad and operator login: rendered with no error overlay or browser-console errors.
- Production HTTP acceptance: client/operator security headers, FlashForge frame isolation, API/PostgreSQL/Redis readiness, capability boundaries, truthful Swap status and CORS all pass.

## Remaining approval gates

This is a deployed production candidate, not final mainnet approval. Mainnet flags remain disabled. Final approval still requires operator Authenticator enrollment, configured external providers (0x, TRON Swap, Paymaster, notification delivery and a real Flash Loan application/API), real-wallet chain acceptance and a timed rollback drill.
