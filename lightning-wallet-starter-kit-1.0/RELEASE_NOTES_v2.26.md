# Lightning Wallet v2.26 production candidate

Version 2.26 hardens the shared Batch Transfer and Asset Collector execution path without enabling mainnet transactions.

## Included

- Public-account matching across installed EVM providers so an authorized MetaMask/Rabby account is no longer bypassed merely because OKX is also installed.
- Connected-public-key matching across OKX, Phantom, Backpack, Solflare and compatible Solana injectors.
- Sender-aware provider selection for multi-sender Batch Transfer and Asset Collector groups, with an explicit fail-closed error when multiple installed wallets remain ambiguous.
- Complete Solana Mainnet/Devnet/Testnet genesis attestation before any batch wallet connection or signature request.
- Exact official TRON Mainnet/Nile/Shasta RPC hostname allowlists; lookalike hosts are rejected before a contract or transfer call.
- Per-receipt EIP-5792 results: a successful receipt is confirmed, a failed receipt is failed, and a missing/ambiguous receipt remains submitted.
- Revalidated EVM public-account cache that avoids repeated provider discovery during a large sequential fallback while detecting account changes before each reuse.

## Safety boundary

- Only public provider objects and public accounts are inspected; no private key, mnemonic or seed phrase is requested or persisted.
- Mainnet transaction, Swap and Launchpad flags remain disabled.
- Network mismatch, sender mismatch, failed receipts and incomplete receipts fail closed or remain visibly pending.
- Wallet signing and broadcasting remain explicit user-wallet actions; the server cannot sign or broadcast.

## Verification

- API: 156 tests passing across 32 files.
- Web: 239 tests passing across 60 files, including 24 focused execution-policy/provider/batch-receipt tests.
- Type check, production build, credential scan, environment-gate tests, provider fixtures and API/Web Docker builds: PASS.
- Production dependency set: 0 high and 0 critical findings; 6 moderate transitive SUN/Solana/Jayson/UUID advisories have no current upstream fix.

## Production rollout

Pending CI, Preview acceptance and guarded production rollout.
