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
- Batch Transfer and Asset Collector have wallet-signed execution paths but still require final wallet-by-wallet acceptance on each supported mainnet.
- Solana Swap can use Jupiter. EVM Swap requires a server-side 0x API key. TRON Swap requires an approved provider adapter.
- Flash Loan currently provides only a safe Sepolia compatibility shell because the referenced historical repository does not contain a completed application.
- GasFree requires an approved Paymaster provider for sponsored transactions.
- Launchpad validates plans and requests user-wallet signatures, but real chain deployment adapters are not yet approved.
- Mainnet execution flags remain off by default.

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
