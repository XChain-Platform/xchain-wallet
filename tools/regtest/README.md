# Regtest integration — `tools/regtest/`

Spec reference: `claude/reports/xchain-wallet/XCHAIN_WALLET_SPEC.md`
§52 (testing) and §49 (offline / degraded mode).

This directory holds helpers for running the wallet against a local
regtest stack — bitcoin / dogecoin / litecoin nodes plus the
`xchain-decoder` / `xchain-indexer` / `xchain-explorer` / `xchain-hub`
backend, all auto-mined by `xchain-regtest-miner` for instant block
confirmations.

The actual stack is **upstream**, not vendored here. It lives at
`REDACTED-LOCAL-PATH` — the platform's CLI
orchestrator. The scripts here are the thin glue that lets the
wallet's smoke / E2E tests target it without re-implementing
docker-compose orchestration.

---

## Why this exists

Several wallet flows can only be exercised end-to-end against a real
indexer:

- Cross-chain LINK threading (§23.5) — needs both chains' indexers
  populated and a real LINK action confirmed on-chain.
- Send + RBF + CPFP (§44) — needs a fee market and a mempool.
- Reachability + offline banner (§49) — needs an actual RPC endpoint
  to flip on and off.
- bridge.signAction → broadcast — needs the encoder + decoder loop.

The wallet's smokes (`test/smoke/`) and unit tests stay out of this
loop — they exercise pure logic. Anything that requires an honest
"signed → broadcast → mined → indexed → read back" round-trip lives
under `test/e2e/` (Playwright) or `test/integration/` (mocha against
a regtest stack).

## Path forward

Today this is **scaffolding only** — `bootstrap.sh` checks that the
upstream stack is reachable; `down.sh` is a thin pointer at the
upstream `xchain-node down` command; tests opt in via
`XCHAIN_REGTEST_BASE_URL` (default `http://localhost`) and skip when
the stack isn't running.

Full E2E provisioning (one-shot `pnpm test:integration` that brings
the stack up, runs every relevant test, tears it down) lands
alongside G163 (E2E Playwright suite against regtest) — pairs with
this row in `claude/reports/xchain-wallet/SPEC_GAPS.md`.

## Inputs

The upstream stack exposes these endpoints (defaults; overridable
via `xchain-node` config):

| Service | Default URL | What the wallet uses |
|---|---|---|
| Bitcoin regtest RPC | `http://localhost:18443` | Send / Sign / fee market |
| Dogecoin regtest RPC | `http://localhost:18332` | Cross-chain LINK |
| Litecoin regtest RPC | `http://localhost:18444` | Cross-chain LINK |
| `xchain-decoder` | `http://localhost:8101/api/decoder` | Mempool transparency |
| `xchain-indexer` | `http://localhost:8102/api/indexer` | Balances / history / orders |
| `xchain-explorer` | `http://localhost:18000` | History route data source |
| `xchain-hub` | `http://localhost:18001` | Hub fetches (G007 / G127) |
| `xchain-regtest-miner` | side-car | Auto-mines pending mempool txs |

Wallet configures these via `settings.sdkEndpoints[chainId]` — Settings
→ Network & Endpoints panel. The bundled regtest descriptors
(`packages/core/src/registry/descriptors/{bitcoin,dogecoin,litecoin}.js`)
already pin the localhost defaults.

## Scripts

| Script | Purpose | Status |
|---|---|---|
| `bootstrap.sh` | Probe the upstream stack; print a readiness report; exit 0 when every service responds. | Scaffolding — runnable today. |
| `down.sh` | Wrapper around `xchain-node stop` — exists so wallet test runners don't depend on the platform repo's exact stop command. | Scaffolding — runnable today. |
| `wait-ready.sh` | Block until every required service responds within a timeout; used by `pnpm test:integration` to bring the stack up before running tests. | Scaffolding — runnable today. |

All three exit 0 on success and a non-zero code with a structured
diagnostic on failure. They never start a stack themselves — that
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
# Bring the upstream stack up — once per dev session.
cd REDACTED-LOCAL-PATH
./xchain-node.sh start

# From the wallet repo:
bash tools/regtest/wait-ready.sh
pnpm test:integration                # runs the wallet suite
bash tools/regtest/down.sh           # optional — leave it up between runs
```

Smokes and unit tests do NOT need any of this — they're synthetic.
Run `pnpm test:smoke` / `pnpm test:unit` against an empty regtest.

## Status today

- ✅ Directory + scripts exist and are reachable from `test/e2e/README.md`.
- ✅ `bootstrap.sh` / `wait-ready.sh` / `down.sh` runnable today against the upstream stack.
- ⏸ Full one-command provisioning (`pnpm test:integration` orchestrates everything) pending G163.
- ⏸ CI integration pending G005 (no-CI-during-build-phase memory rule).
