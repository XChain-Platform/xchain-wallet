# Unit tests

Pure-logic, isolated, fast (< 5 s per file). One module under test per file.
No network, no real DB, no real wallet host — anything that crosses a
boundary belongs in `../integration/` or `../e2e/`.

## Layout

```
test/unit/
├── crypto/      AEAD, KDF, WIF, mnemonic, BIP32 derivation
├── sdk/         SDKRegistry contract, adapter wrappers
├── util/        UUID, formatting, small helpers
├── ui/          React component primitives via @testing-library
└── decoder.test.js   ACTION-bytes decoder logic
```

## Run

```bash
pnpm -C packages/core test:unit            # one-shot
pnpm -C packages/core test:unit -- --watch # watch mode
```

## Conventions

- File suffix: `*.test.js` (or `*.test.jsx` for React components).
- One `describe` per module/symbol; nested `describe`s for axes
  (`describe('encrypt', () => describe('with no AAD', () => …))`).
- Each test's first line should answer "what behavioural property
  is asserted?" rather than "what code is called?"
- No `beforeAll(async)` longer than 100 ms in unit — that's the
  smell that says "you're in integration territory."
- Deterministic only. If a test depends on randomness, seed it.
- Cross-package imports are fine, but if the test setup needs a
  real Vault / Argon2 derivation / messaging round-trip, move it
  to `../integration/`.

## Coverage target

This layer aims for ≥ 80 % line coverage on `packages/core/src/crypto/`,
`packages/core/src/sdk/`, `packages/core/src/util/`,
`packages/core/src/schemas/`. UI primitives are best-effort; the
behavioural surface lives mostly in `../e2e/` (Playwright).
