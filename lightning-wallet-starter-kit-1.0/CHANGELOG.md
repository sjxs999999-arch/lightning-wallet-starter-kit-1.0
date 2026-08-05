# Changelog

All notable stable Lightning Wallet releases are recorded here.

## stable-v1.7-launchpad

### Added

- Five-step Token creation, metadata, media, liquidity and review wizard.
- EVM Sepolia, Solana Devnet and TRON Nile deployment-plan support.
- Logo and banner preview plus PDF whitepaper validation.
- Website and social-link editor with HTTP(S)-only validation.
- Realtime Token information preview.
- Worker-based fixed-point liquidity initialization planning.
- Deployment checklist and EVM, Solana and TRON wallet-signature adapters.

### Security

- Uploads remain local; the API receives only sanitized file descriptors.
- SVG, executable, unsupported and oversized files are rejected.
- Private keys and mnemonics are never accepted or stored.
- The server does not sign or broadcast deployment transactions.
- Non-Dry-Run flows require explicit user-wallet confirmation.

### Verification

- Implementation commit: `8c23402`
- API and web tests: 56/56 PASS
- Type check, production build and Docker build: PASS
- Three-chain Dry Run plans: PASS
- 1,000 Worker liquidity plans: approximately 0.542 ms
- Preview reload and error-boundary validation: PASS
- Browser console errors: 0
- Preview: `http://localhost:4173/launchpad`

## stable-v1.6-gasfree

### Added

- Gas Sponsor abstraction and configurable HTTP Paymaster adapter.
- Authenticated Sepolia RPC gas estimation.
- Automatic gas top-up planning with minimum-reserve controls.
- Standard, Silver and Gold VIP gas policies.
- Worker-based planning, 30-second gas monitoring and metadata-only local history.
- Dry Run Sponsor eligibility validation and isolated provider failures.

### Security

- Private keys, mnemonics and signing material are never accepted or stored.
- The API does not sign or broadcast transactions.
- Real execution remains behind explicit user-wallet confirmation and signature.
- Unauthenticated requests and mainnet Sponsor requests are rejected.
- The stable environment remains Dry Run only until an approved Paymaster is configured.

### Verification

- Implementation commit: `eaf7c92`
- API and web tests: 48/48 PASS
- Type check, production build and Docker build: PASS
- Live Sepolia RPC estimate: PASS
- 1,000 Worker plans: approximately 0.597 ms
- Preview reload and history persistence: PASS
- Browser console errors: 0
- Preview: `http://localhost:4173/gasfree`

## stable-v1.5-flash-loan

### Added

- Navigation and embedded integration for the existing FlashForge application.
- Five-minute authenticated integration sessions restricted to the operator role.
- Shared public wallet address, Sepolia network, dark theme and mandatory Dry Run context.
- Metadata-only Flash Loan history bridge with strict field sanitization.
- Standalone launch fallback, service health status and isolated error handling.

### Security

- Flash Loan logic was not rewritten and server-side signing was not added.
- Private keys, mnemonics, seed phrases and signing capability are never shared.
- Unauthenticated, mainnet and non-Dry-Run integration sessions are rejected.
- Cross-window messages require the configured origin and reject sensitive fields.
- The embedded application is constrained by an iframe sandbox.

### Verification

- Integration commit: `64f622d`
- API and web tests: 40/40 PASS
- Type check, production build and Docker build: PASS
- API health, authenticated session and browser refresh checks: PASS
- Browser console errors: 0
- Preview: `http://localhost:4173/flash-loan`
- FlashForge currently operates in legacy compatibility mode because its existing build does not acknowledge the optional shared message protocol.

## stable-v1.4-swap

### Added

- EVM 0x AllowanceHolder, Solana Jupiter and configurable TRON Swap adapters.
- Aggregated quotes, best-route selection, minimum received amount and price impact.
- Slippage controls, exact-amount approval and wallet-signature execution boundaries.
- Dry Run, Worker quote requests, 30-second automatic refresh and local Swap history.
- Quote timeout and empty-route failure handling.

### Security

- No private keys, mnemonics or server-side transaction signing.
- Mainnet execution remains disabled unless explicitly enabled.
- Wallet rejection results in no broadcast.
- High slippage and excessive price impact are blocked.

### Verification

- Implementation commit: `343f617`
- Final validation commit: `e7f1358`
- Swap tests: 9/9 PASS
- 1,000-route selection performance: approximately 1 ms
- 100 live Jupiter quote requests: 52.94 ms average, 100/100 successful
- Production build and Docker Preview: PASS
- No real testnet Swap was broadcast because authorized funded test wallets were unavailable.

## stable-v1.3-asset-collector

### Added

- EVM, Solana and TRON wallet asset scanning.
- Native coin and configured token detection.
- Minimum-balance retention and automatic fee estimation.
- Client-side Dry Run and batch collection workflow.
- Worker-based scanning with realtime progress.
- Pause, resume, failed-task retry, session logs and CSV result export.
- BigInt fixed-point collection calculations.

### Security

- Private keys and mnemonics remain outside the API, database and logs.
- Real collection transactions require wallet confirmation and signature.
- Sensitive CSV fields are rejected.
- Individual RPC failures are isolated without blanking the page.

### Verification

- Implementation commit: `600e895`
- Asset Collector tests: 6/6 PASS
- 1,000-task planning performance: approximately 28 ms
- Production build: PASS
- Docker build and local Preview: PASS

## stable-v1.2-batch-transfer

- Added EVM, Solana and TRON batch transfers.
- Added CSV templates, validation, Dry Run, progress, pause/resume, retry and result export.

## stable-v1.1-wallets

- Added client-side EVM, Solana and TRON batch wallet generation.
- Added public CSV and encrypted JSON export.

## stable-v1.0-local

- Established the verified local frontend, API, PostgreSQL, Redis and Docker baseline.
