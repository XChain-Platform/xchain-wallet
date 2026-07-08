# Fuzz tests

Property-based tests via `fast-check`. Each property holds for ALL
inputs in a domain - fast-check generates inputs, the property
either holds or fast-check shrinks to a minimal counter-example.

## Layout

```
test/fuzz/
├── harness/
│   ├── aead-roundtrip.fuzz.js     encrypt(decrypt(x)) === x for any x
│   ├── format-amount.fuzz.js      formatAmount invariants on output
│   └── icon-for-label.fuzz.js     iconForLabel never throws
```

## Tuning iteration count

Default is fast-check's default (100 runs per property). For deeper
sweeps:

```bash
FUZZ_ITERATIONS=2000 pnpm test:fuzz
```

## Run

```bash
pnpm test:fuzz
```
