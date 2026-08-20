# Lightning Wallet v2.30 production candidate

Version 2.30 restores the missing everyday Wallet Center without replacing the verified batch-wallet engine or weakening the production gates. It remains a production candidate: no mainnet switch is enabled and no final mainnet approval is implied.

## Wallet Center

- Creates EVM, Solana and TRON wallets entirely in the browser.
- Imports BIP39 mnemonic phrases and chain-native private keys; EVM also accepts encrypted Keystore JSON.
- Derives additional accounts from a locally encrypted mnemonic.
- Shows a receive QR code and exposes a validated handoff to Batch Transfer.
- Stores address-book and custom Token metadata locally; balance, Token and NFT inspection opens the appropriate read-only explorer.
- Retains MetaMask, WalletConnect, OKX Wallet, Rabby, Phantom, Backpack, Solflare and TronLink under the extension-wallet tab.

## Security

- Private keys and mnemonics are encrypted with AES-256-GCM using PBKDF2-SHA-256 with 600,000 iterations before persistence.
- The password and plaintext key material are never stored in React state, local/session storage, API requests, databases or logs.
- The non-extractable Web Crypto key exists only in the current tab and locks after 15 minutes without activity or when the page is left.
- Encrypted vault import is schema-limited to 5 MB, rejects plaintext secret fields and validates all public addresses.
- Recovery uses the existing Worker-backed address verification and clears visible material after 60 seconds or on navigation.
- Real transactions still require an explicitly connected wallet and all mainnet gates remain disabled.

## Verification

- Web type check: PASS.
- ESLint: PASS.
- Web tests: 272/272 PASS across 68 files, including nine new Wallet Center isolation, encryption, import and metadata tests.
- Full production build: PASS.
- Local browser acceptance: Wallet Center route, provider tab, refresh and Wallet Center-to-Batch Transfer handoff PASS with zero console errors and no white screen.
- No wallet connection, signature or transaction broadcast was requested during automated acceptance.

## Remaining final gates

The five external provider blockers, authorized wallet acceptance and all mainnet execution switches remain unchanged and fail closed.
