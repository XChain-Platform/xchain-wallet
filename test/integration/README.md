# Integration tests

Multi-module flows that wire real Vaults to real (in-memory) storage
backends, derive real HD keys, run real schema migrations, and exercise
the code at the Vault / Backend / Schema seams. No network - anything
that crosses the wire (RPC, explorer, hardware wallet, real Argon2 with
mainnet params) belongs in `../e2e/` or stays mocked.

## What lives here

```
test/integration/
├── vault/         Vault open/save/reload round-trips, codec opacity
├── storage/       Backend contract: InMemoryBackend conforms to the abstract
├── migrations/    Schema migrations run on read (e.g. Wallet v1 → v2)
├── multisig/      MultisigConfig creation + persistence + reload
├── hd/            HD derivation across BTC / LTC / DOGE from one seed
└── flows/         Onboarding / unlock / lock state machines (no network)
```

## Run

```bash
pnpm test:integration            # one-shot
pnpm test:integration -- --watch # watch mode
```

## Conventions

- Filename: `*.test.js` (or `*.test.jsx`).
- One flow per file - describe what's being wired, not what's being asserted.
- Use the in-memory backend (`@xchain-wallet/core` exports it under
  `storage.InMemoryBackend`) so tests don't touch real disk / IDB / chrome.storage.
- Use the floor KDF parameters (`KDF_MIN_*`) so tests stay fast.
- Tests can take up to 30 s each (timeout configured at the suite level).
- Cleanup is a no-op - InMemoryBackend lives only inside the test scope.
- Tests should NOT spawn child processes, open ports, or hit the network.

## Coverage target

This layer aims to verify every seam crossing - encrypt → store → load
→ decrypt; schema v1 record → migrated v2 record on first read; create
wallet → reopen the same backend → wallet still there. Per-module coverage
lives in `../unit/`.
