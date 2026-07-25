# Regtest integration - `tools/regtest/`

Spec reference: `claude/reports/xchain-wallet/XCHAIN_WALLET_SPEC.md`
§52 (testing) and §49 (offline / degraded mode).

This directory holds helpers for running the wallet against a local
regtest stack - bitcoin / dogecoin / litecoin nodes plus the
`xchain-decoder` / `xchain-indexer` / `xchain-explorer` / `xchain-hub`
backend, all auto-mined by `xchain-regtest-miner` for instant block
confirmations.

The actual stack is **upstream**, not vendored here. It lives at
`~/Sites/XChain-Platform/xchain-node` - the platform's CLI
orchestrator. The scripts here are the thin glue that lets the
wallet's smoke / E2E tests target it without re-implementing
docker-compose orchestration.

---

## Why this exists

Several wallet flows can only be exercised end-to-end against a real
indexer:

- Cross-chain LINK threading (§23.5) - needs both chains' indexers
  populated and a real LINK action confirmed on-chain.
- Send + RBF + CPFP (§44) - needs a fee market and a mempool.
- Reachability + offline banner (§49) - needs an actual RPC endpoint
  to flip on and off.
- bridge.signAction → broadcast - needs the encoder + decoder loop.

The wallet's smokes (`test/smoke/`) and unit tests stay out of this
loop - they exercise pure logic. Anything that requires an honest
"signed → broadcast → mined → indexed → read back" round-trip lives
under `test/e2e/` (Playwright) or `test/integration/` (mocha against
a regtest stack).

## Path forward

Today this is **scaffolding only** - `bootstrap.sh` checks that the
upstream stack is reachable; `down.sh` is a thin pointer at the
upstream `xchain-node down` command; tests opt in via
`XCHAIN_REGTEST_BASE_URL` (default `http://localhost`) and skip when
the stack isn't running.

Full E2E provisioning (one-shot `pnpm test:integration` that brings
the stack up, runs every relevant test, tears it down) lands
alongside G163 (E2E Playwright suite against regtest) - pairs with
this row in `claude/reports/xchain-wallet/SPEC_GAPS.md`.

## Inputs

The wallet SDK talks to exactly three service classes: one shared
explorer, one encoder per chain, one shared hub. It does NOT hit the
nodes / decoders / indexers directly - those sit upstream of the
explorer, and the explorer's status endpoint is what surfaces decoder
wiring. These are the endpoints `bootstrap.sh` probes, matching the
bundled regtest descriptors:

| Service | Default URL | What the wallet uses |
|---|---|---|
| `xchain-explorer` | `http://localhost:18080` | Balances / history / orders / decoder-wiring status |
| `xchain-encoder` (BTC) | `http://localhost:3023` | Compose / sign / broadcast |
| `xchain-encoder` (DOGE) | `http://localhost:3123` | Compose / sign / broadcast |
| `xchain-encoder` (LTC) | `http://localhost:3223` | Compose / sign / broadcast |
| `xchain-hub` | `http://localhost:10000` | Hub fetches (G007 / G127) |

Upstream-only (not probed; reached through the explorer): the
bitcoin / dogecoin / litecoin regtest nodes, `xchain-decoder`,
`xchain-indexer`, and the `xchain-regtest-miner` side-car that
auto-mines pending mempool txs.

Wallet configures the three service classes via
`settings.sdkEndpoints[chainId]` - Settings → Network & Endpoints
panel. The bundled regtest descriptors
(`packages/core/src/registry/descriptors/{bitcoin,dogecoin,litecoin}.js`)
already pin these localhost defaults.

### Pointing at the devhost stack over SSH

The shared regtest stack runs on **devhost**, not on the Mac. The
descriptors use `localhost`, so forward the five ports over SSH before
running any regtest-backed test from the Mac:

```bash
ssh -N \
  -L 18080:localhost:18080 \
  -L 3023:localhost:3023 \
  -L 3123:localhost:3123 \
  -L 3223:localhost:3223 \
  -L 10000:localhost:10000 \
  devhost
```

With the tunnel up, `bash tools/regtest/bootstrap.sh` reports green and
the e2e round-trip targets the live stack. Alternatively run the tests
on devhost itself (localhost resolves natively there).

## Scripts

| Script | Purpose | Status |
|---|---|---|
| `bootstrap.sh` | Probe explorer + per-chain encoders + hub; print a readiness report; exit 0 when every service responds AND the explorer's status shows its decoders wired (not just a live socket). | Runnable today; validated against the live devhost stack 2026-07-24. |
| `down.sh` | Wrapper around `xchain-node stop` - exists so wallet test runners don't depend on the platform repo's exact stop command. | Scaffolding - runnable today. |
| `wait-ready.sh` | Block until every required service responds within a timeout; used by `pnpm test:integration` to bring the stack up before running tests. | Scaffolding - runnable today. |
| `roundtrip.cjs` | Reusable funded-signer round-trip driver ( / spec §14): funds a fresh key from the node wallet, then runs each action through create -> encode -> sign -> broadcast -> confirm -> read-back via the SDK, against the live indexer. Run after the tunnel is up. | Runnable; validated 2026-07-24 (LIST round-trip indexes valid). |

All three exit 0 on success and a non-zero code with a structured
diagnostic on failure. They never start a stack themselves - that
lives in `xchain-node`. The contract is "the wallet expects you to
have run `xchain-node start` first."

## Environment variables

| Var | Purpose | Default |
|---|---|---|
| `XCHAIN_REGTEST_BASE_URL` | Hostname (with optional port) where every regtest service lives. The scripts append the canonical paths. | `http://localhost` |
| `XCHAIN_REGTEST_TIMEOUT_MS` | How long `wait-ready.sh` polls before failing. | `60000` |
| `XCHAIN_REGTEST_VERBOSE` | When set, scripts emit one log line per probe. | unset |

## Per-test-suite procedure

```bash
# Bring the upstream stack up - once per dev session.
cd ~/Sites/XChain-Platform/xchain-node
./xchain-node.sh start

# From the wallet repo:
bash tools/regtest/wait-ready.sh
pnpm test:integration                # runs the wallet suite
bash tools/regtest/down.sh           # optional - leave it up between runs
```

Smokes and unit tests do NOT need any of this - they're synthetic.
Run `pnpm test:smoke` / `pnpm test:unit` against an empty regtest.

## Status today

- ✅ Directory + scripts exist and are reachable from `test/e2e/README.md`.
- ✅ `bootstrap.sh` / `wait-ready.sh` / `down.sh` runnable today against the upstream stack.
- ⏸ Full one-command provisioning (`pnpm test:integration` orchestrates everything) pending G163.
- ⏸ CI integration pending G005 (no-CI-during-build-phase memory rule).
