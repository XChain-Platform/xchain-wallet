# Mutation testing

Stryker mutates `packages/core/src/crypto/*` and `packages/core/src/util/*`,
then runs the unit suite against each mutant. A surviving mutant means
the unit suite isn't strong enough to detect a real-world subtle change
(e.g., flipping a comparison operator, replacing `===` with `==`).

## Run

```bash
pnpm test:mutation
```

Reports drop to `reports/mutation/index.html`.

## Kill-rate target

Not enforced yet - crypto + util are still expanding. Once stable,
add `thresholds: { high: 90, low: 80, break: 75 }` to the config
to fail CI on regressions.

## Adding files to the mutation surface

Edit `mutate: [...]` in `stryker.config.mjs`. Keep the surface narrow
- mutation is expensive (each mutant runs the full unit suite), so
mutate the load-bearing modules where a subtle break would have real
consequences (crypto, signers, validators), not display code.
