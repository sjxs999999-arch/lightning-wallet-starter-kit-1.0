# Internal and public beta acceptance

This repository has two release gates. They deliberately keep source-code success, provider availability, wallet connection, simulation, user signing and public-chain broadcast as separate facts.

| Evidence boundary | Internal beta | Public beta |
| --- | --- | --- |
| Clean, committed checkout | required | required |
| Lint, typecheck, unit/integration tests, production build, secret scan | required and rerun | required and rerun |
| Production client/admin/API health | required | required |
| All capability-provider blockers cleared | required | required |
| Live public provider quotes | required; no wallet access | required; no wallet access |
| Flash Loan and GasFree runtime status | test-network runtime may be ready | must explicitly report `mainnetEnabled=true` |
| Wallet connected for every transactional feature | required | required |
| Pre-sign simulation for every transactional feature | required | required |
| User-wallet signature | tracked separately; may remain pending | required |
| Public-chain broadcast and confirmation | tracked separately; may remain pending | required and checked against RPCs |
| Independent transaction-intent decoding | not required | required; approved verifier must decode the on-chain payload |
| Mainnet execution/Swap/Launchpad/Bridge gates | may remain off | must all be on and final readiness must pass |

LP Manager is currently accepted only as a read-only public-position view with an explicit handoff to official liquidity interfaces. It is not counted as an in-app simulation, signature or broadcast path.

The verifier never connects a wallet, asks for a signature or submits a transaction. Those actions stay in the authorized tester's browser wallet. The report stores public transaction references only; it must never contain a private key, mnemonic, seed phrase, password or raw signature. The report's `intentHash` is operator-attested and transaction-bound; it is not, by itself, proof that the on-chain payload was decoded. At the public gate, every feature-flow transaction must match the provider, chain, network and reference in the SHA-256-locked wallet acceptance report, the RPC verifier must confirm it, and a separately approved SHA-256-pinned verifier must decode the on-chain payload and emit a result bound to the exact release commit and wallet-report digest.

## Run the gates

1. Copy `scripts/fixtures/release-acceptance.template.json` outside the repository and fill it only with observed evidence. Keep the release checkout clean and committed.
2. For the internal gate, leave signing, broadcast and confirmation as `pending` or `not-run`, but every required connection and simulation must be `pass`:

   ```sh
   ./scripts/verify-beta-readiness.sh internal /absolute/path/release-acceptance.json
   ```

3. Before the public gate, complete the existing wallet-by-wallet production acceptance report, verify its SHA-256, put that digest in `walletAcceptance.reportSha256`, and record only confirmed public transaction references in each flow. Then run:

   ```sh
   FINAL_WALLET_ACCEPTANCE_REPORT=/absolute/path/wallet-acceptance.json \
   FEATURE_INTENT_VERIFIER=/absolute/path/approved-onchain-intent-verifier \
   FEATURE_INTENT_VERIFIER_APPROVED_SHA256=<reviewed-verifier-sha256> \
     ./scripts/verify-beta-readiness.sh public /absolute/path/release-acceptance.json
   ```

   The intent verifier must output one JSON object with format `lightning-wallet-intent-verification-v1`, mode `independent-chain-decoder`, intent source `on-chain-transaction-payload`, the exact release/commit/wallet-report SHA-256, `verified: true`, and `verifiedTransactions: 8`. Without this independently reviewed decoder, the public gate fails closed.

`INTERNAL BETA READY` is not permission to enable transaction flags or call a feature live. Only `PUBLIC BETA READY` means all automated gates passed, and every wallet prompt still requires the tester's explicit approval.
