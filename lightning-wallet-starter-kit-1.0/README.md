# ⚡ Lightning Wallet

Lightning Wallet is a non-custodial, multi-chain wallet platform built with React, TypeScript, Vite, Fastify, PostgreSQL, Redis and Docker Compose.

## Production surfaces

- Client: `https://lightingwallet.com`
- Operator console: `https://admin.lightingwallet.com`
- API: `https://api.lightingwallet.com`

The client is wallet-first and does not require an operator account. The operator console is a separate authenticated control surface. Private keys and mnemonics are generated or decrypted only in browser memory and Web Workers; they are not accepted by the API.

## Current release state

This branch is a production candidate, not a final mainnet approval. The truthful capability matrix is maintained in [PROJECT_STATUS.md](./PROJECT_STATUS.md). In particular:

- Wallet generation, encrypted export, address verification and read-only centers are implemented.
- Wallet Center exposes MetaMask, WalletConnect, OKX, Rabby, Phantom, Backpack, Solflare and TronLink across the applicable testnet adapters, with exact network/account revalidation and confirmed-receipt checks before recording success.
- Batch Transfer and Asset Collector have wallet-signed execution paths but still require final wallet-by-wallet acceptance on each supported mainnet.
- Batch Transfer and Asset Collector match the intended sender against already-authorized public accounts, attest Solana genesis and exact TRON RPC hosts before signing, and never promote incomplete EIP-5792 receipts to confirmed success.
- Solana Batch Trade requires the global and Swap-specific mainnet gates, attests the exact Mainnet genesis, matches the injected wallet and serialized transaction payer, and distinguishes confirmed, submitted and failed broadcasts.
- EVM Swap uses LI.FI same-chain aggregation by default, with optional 0x comparison; Solana uses Jupiter and TRON uses the official SUN.io Smart Router. Provider data, intended sender, exact network and confirmed receipt are revalidated, and every real transaction remains wallet-signed.
- Bridge route comparison is read-only by default. Real EVM/Solana Bridge execution additionally requires both the global mainnet switch and the independent Bridge switch; both remain off.
- Flash Loan currently provides only a safe Sepolia compatibility shell because the referenced historical repository does not contain a completed application.
- GasFree top-up is Sepolia-only with sender-aware wallet selection and exact chain/account/Gas/receipt checks; sponsored transactions still require an approved Paymaster provider.
- Launchpad builds fixed-supply deployments in the client for Sepolia, Ethereum, BSC, Polygon, Base, Arbitrum, Solana Devnet/Mainnet and TRON Nile/Shasta/Mainnet. Mainnet Launchpad requires both the global mainnet switch and its independent release switch; both remain off pending real-wallet acceptance.
- Mainnet execution flags remain off by default.
- `/api/v1/system/capabilities` exposes the same fail-closed readiness state to both domains. `scripts/verify-final-readiness.sh` will fail until the five external providers, authorized wallet acceptance and all independent mainnet gates are complete.

## Local development

Requirements: Node.js 20+, npm 10+, Docker Compose v2.

```bash
cp .env.example .env
npm ci
npm run typecheck
npm test
npm run build
npm run dev
```

Launchpad contract artifacts are reproducible with `npm run contract:compile` (upstream Solidity for EVM) and `npm run contract:compile:tron` (checksum-pinned official TRON Solidity compiler). Artifacts are committed; production web builds never compile contracts at runtime.

Swap, Launchpad and Bridge mainnet execution are fail-closed. Each requires `VITE_MAINNET_EXECUTION_ENABLED=true` plus its own `VITE_ENABLE_MAINNET_*` switch at web build time, the protected production preflight must run with `STRICT_EXTERNAL_PROVIDERS=true`, and `FINAL_WALLET_ACCEPTANCE_APPROVED=true` is accepted only with a verified, SHA-256-locked wallet acceptance report. Copy `scripts/fixtures/wallet-acceptance.template.json` outside Git, complete it with real testnet references, and verify it with `scripts/verify-wallet-acceptance.sh`. Selecting a mainnet in Dry Run never connects a wallet.

- Web: `http://localhost:5173`
- API: `http://localhost:3001`
- Health: `http://localhost:3001/health`

## Production deployment

Use [DEPLOYMENT_v2.1.md](./DEPLOYMENT_v2.1.md). Do not place private keys, mnemonics, wallet passwords or provider secrets in Git. Production secrets belong only in the protected server environment.

## Repository layout

```text
apps/web       Non-custodial client and separate operator UI
apps/api       Fastify API, provider adapters and metadata-only audit APIs
packages/core  Shared chain definitions and contracts
database       PostgreSQL initialization
docker         Immutable API/web images and Nginx policy
scripts        Deploy, backup and restore workflows
```

## Safety invariants

- No API endpoint accepts a private key or mnemonic.
- The server never signs or broadcasts on behalf of a user.
- Every real transaction requires the connected wallet's confirmation.
- Dry Run is the default where transaction planning is supported.
- RPC/provider failures are contained by route and component error boundaries.
- Operator sessions use revocable HttpOnly cookies, CSRF checks and rate limits.
- Mainnet features are enabled only after chain-specific acceptance evidence is recorded.
