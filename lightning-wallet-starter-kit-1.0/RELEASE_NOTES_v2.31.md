# Lightning Wallet v2.31 production candidate

Version 2.31 adds direct browser-local testnet signing to the encrypted Wallet Center. It does not enable mainnet execution and does not change any final production approval gate.

## Local testnet transfer

- Plans and estimates native-coin and configured Token transfers for EVM Sepolia, Solana Devnet and TRON Nile/Shasta.
- Requires an explicit transaction preview and browser confirmation before any key decryption or signature.
- Decrypts exactly one selected private key inside a dedicated one-shot Web Worker, re-derives the wallet address and refuses mismatches before signing.
- Broadcasts only the signed public transaction from the browser and records only public transaction metadata locally.
- Verifies EVM sender/Chain ID, Solana fee payer/signature/genesis and official TRON testnet RPC hosts before broadcast.
- Expires transaction plans after 90 seconds and keeps the confirmation button disabled after validation or RPC failure.

## Security boundaries

- Private keys and mnemonics never enter React state, API requests, databases, logs or transaction history.
- The non-extractable vault `CryptoKey` is cloned into the one-shot Worker; decrypted bytes are zeroed and the Worker closes after success or failure.
- Signing and broadcasting lock wallet switching until the operation finishes, preventing account/context races.
- Page refresh locks the vault and preserves only AES-256-GCM ciphertext plus validated public metadata.
- Mainnet execution, Swap, Launchpad and Bridge flags remain false. No automated test connected a wallet, signed or broadcast a real transaction.

## Verification

- Runtime commit: `5963902`.
- API tests: 159/159 PASS across 33 files.
- Web tests: 278/278 PASS across 71 files.
- Wallet Center tests: 15/15 PASS, including EVM/Solana/TRON signature verification, key/address mismatch rejection, storage schema and isolation checks.
- Type check, ESLint, production build, credential scan, production environment tests, rollback tests and provider fixture tests: PASS.
- API and Web Docker image builds: PASS.
- Production dependency gate: 0 critical, 0 high; 6 moderate transitive advisories remain without compatible fixes.
- Local browser acceptance: v2.31 route/reload, automatic vault lock and isolated RPC-error rendering PASS without a white screen. No signature or broadcast was requested.
- The local signing Worker entry is 2.18 kB and chain SDKs load only when their corresponding chain is used; the Wallet Center route chunk decreased from approximately 802 kB to 44 kB.

## Remaining final gates

The five external provider blockers, authorized real-wallet acceptance and all mainnet execution switches remain unchanged and fail closed.

