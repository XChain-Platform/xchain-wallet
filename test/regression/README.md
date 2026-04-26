# Regression tests

Pinned past incidents. Every entry references a specific past defect
and is tagged so the runner can scope to a priority slice.

## Tagging

Add `[REGRESSION P0]` (or `P1`, `P2`) to each `it(...)` description.
The default `pnpm test:regression` runs P0 + P1; `:critical` is P0
only; `:full` runs every priority.

## Adding a new entry

1. Reference the defect in the comment block (date + one-line summary).
2. Reproduce the failing condition under the test.
3. Tag with `[REGRESSION P0]`, `[REGRESSION P1]`, or `[REGRESSION P2]`.
4. NEVER remove a regression test — even if the surface it tested is gone,
   document the deletion in the comment and convert to a smoke check that
   the surface is indeed absent.

## Run

```bash
pnpm test:regression                    # P0 + P1
pnpm test:regression -- --grep "P0"     # P0 only
pnpm test:regression -- --grep "P[012]" # everything
```
