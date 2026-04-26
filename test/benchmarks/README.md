# Benchmarks

Throughput / latency / memory measurements for hot paths the wallet
runs at user-facing speed (KDF, AEAD, balance-list formatting, Vault
open/close).

The harness is intentionally simple — each scenario is a function
that runs N iterations and reports the median + p95. No external
dependencies, no flame-graph wiring; the goal is "we know if a PR
made the unlock 2× slower."

## Scenarios

```
test/benchmarks/scenarios/
├── kdf.bench.js           Argon2id at floor + production tiers
├── aead.bench.js          encrypt + decrypt at 1 KB, 10 KB, 1 MB
├── format-amount.bench.js  groupThousands + trailing-zero trim throughput
└── vault-open.bench.js    open + close round-trip with N wallet records
```

## Run

```bash
pnpm test:bench               # full sweep
pnpm test:bench:quick         # short pre-PR sanity (~ 5 s)
```

## Baselines

`test/benchmarks/baselines/` holds saved JSON baselines. Compare with:

```bash
node test/benchmarks/harness.js --save-baseline
node test/benchmarks/harness.js --compare
```

CI will gate when comparison shows a > 30 % regression.
