# Boundary tests

Constraint / edge-case validation. Each test pins a specific limit
(min, max, off-by-one, overflow, empty-set behaviour) so a refactor
that quietly relaxes the limit fails here before it ships.

## Layout

```
test/boundary/
├── crypto/     KDF param floors, AAD size limits, key length edges
├── amounts/    BigInt atomic-unit math at max divisibility, overflow
├── mnemonic/   word counts (11/12/13/15/18/21/24/25), empty input
└── pubkey/     compressed-vs-uncompressed length, hex shape
```

## Run

```bash
pnpm test:boundary
```
