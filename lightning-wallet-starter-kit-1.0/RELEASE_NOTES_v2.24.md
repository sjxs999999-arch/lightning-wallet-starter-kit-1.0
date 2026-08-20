# Lightning Wallet v2.24 production candidate

Version 2.24 extends the existing non-custodial Launchpad adapters to formal EVM, Solana and TRON networks while keeping every mainnet deployment path fail-closed by default.

## Included

- EVM: Sepolia, Ethereum, BSC, Polygon, Base and Arbitrum with exact chain switching, checksummed active-account validation, dynamic fee symbols and explorer links.
- Solana: Devnet and Mainnet with exact full genesis-hash validation, client-built fixed-supply SPL Token creation and immediate mint-authority revocation.
- TRON: Nile, Shasta and Mainnet with exact official RPC-host matching and client-built fixed-supply TRC-20 deployment.
- Consistent chain/network validation in the Fastify API, Vercel Serverless validator and browser client.
- A selectable network control that preserves Dry Run as the default and clearly labels mainnet choices.

## Security boundary

- Mainnet Launchpad requires both `VITE_MAINNET_EXECUTION_ENABLED=true` and `VITE_ENABLE_MAINNET_LAUNCHPAD=true`; production additionally requires the strict external-provider acceptance gate.
- A closed mainnet gate rejects before discovering, connecting or requesting any wallet account.
- Dry Run validates public metadata only and never connects a wallet.
- Deployment transactions are constructed in the browser and require the current extension wallet to confirm, sign and broadcast.
- The API stores only public project/plan metadata; it has no private-key, mnemonic, signing or broadcast path.
- Generated Solana mint key material is zeroized after preparation or execution.

## Correctness fix

- Replaced the previously truncated Solana Devnet genesis fingerprint with the complete cluster fingerprint and added the full Mainnet fingerprint. This fixes false rejection of a genuine Devnet RPC and prevents cross-cluster deployment.

## Verification

- API: 156 tests passing across 32 files.
- Web: 222 tests passing across 60 files.
- Type check, production build, credential scan, production environment tests, live-provider fixtures and API/Web Docker image builds: PASS.
- Production dependency set: 0 high and 0 critical findings; 6 moderate transitive SUN/Solana/Jayson/UUID advisories currently have no upstream fix.
- The full development dependency tree also reports build-tool advisories with no registry-provided fix; no unsafe forced dependency upgrade was applied.
- No real transaction, signature or broadcast was requested during automated verification.

## Production rollout

- Pending CI, Preview and guarded production acceptance.
- Mainnet transaction, Swap and Launchpad flags remain disabled.
