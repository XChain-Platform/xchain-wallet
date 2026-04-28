# Release-signing pipeline — `tools/release/`

Spec reference: `claude/reports/xchain-wallet/XCHAIN_WALLET_SPEC.md` §51.

This directory holds the scripts and conventions for cutting a signed
release. Today the pipeline ships in **scaffolding form** — the
scripts run end-to-end against a built artifact set, but the actual
GPG signing step requires the maintainer's release key to be
configured. Until the release key is published (G180 in
`claude/reports/xchain-wallet/SPEC_GAPS.md`), `sign.sh` exits with a
clear error pointing at `SECURITY.md`.

The companion verification side lives at `docs/VERIFY-RELEASE.md` —
end users follow that recipe to verify what this pipeline produces.

---

## Inputs

The pipeline expects a built artifact directory containing one or
more of:

- `*.dmg` / `*.app.zip`     — desktop macOS
- `*.exe` / `*.msi`         — desktop Windows
- `*.AppImage` / `*.deb`    — desktop Linux
- `xchain-wallet-extension-vX.Y.Z.zip`  — extension store bundle
- `xchain-wallet-web-vX.Y.Z.tar.gz`     — static web SPA bundle

Build invocation per shell is documented in `CONTRIBUTING.md` →
"Per-shell builds".

## Scripts

| Script | Purpose | Status |
|---|---|---|
| `sign.sh` | Compute SHA-256 manifest of every artifact in the input directory; GPG-sign the manifest with the release key. | Scaffolding — reachable, but errors out if `XCHAIN_RELEASE_GPG_KEY` is unset (G180 pending). |
| `verify.sh` | Local verification helper: re-compute hashes and verify the GPG signature on a downloaded `RELEASE_HASHES.txt`. Mirrors the recipe in `docs/VERIFY-RELEASE.md`. | Scaffolding — runnable today. |

Both scripts use `set -euo pipefail`. Both refuse to overwrite an
existing manifest / signature file unless `--force` is passed.

## Environment variables

| Var | Purpose | Required by |
|---|---|---|
| `XCHAIN_RELEASE_GPG_KEY` | GPG key fingerprint or email used for signing. | `sign.sh` |
| `XCHAIN_RELEASE_DIR` | Path to the directory containing artifacts to sign. | `sign.sh` (also accepts `--input <dir>`) |
| `GNUPGHOME` | Optional override for the GPG home directory; useful when running from CI with a vendored key store. | both |

## Per-release procedure

1. Build every shell at the release tag (`pnpm --filter @xchain-wallet/desktop dist`, `pnpm --filter @xchain-wallet/extension build`, `pnpm --filter @xchain-wallet/web build`).
2. Stage all artifacts into a single directory: `release-artifacts/vX.Y.Z/`.
3. Run `XCHAIN_RELEASE_GPG_KEY=<fingerprint> bash tools/release/sign.sh --input release-artifacts/vX.Y.Z/`.
4. Upload `RELEASE_HASHES.txt` + `RELEASE_HASHES.txt.asc` + every artifact to the GitHub release tag.
5. Run `bash tools/release/verify.sh --input release-artifacts/vX.Y.Z/` from a clean checkout to confirm the round-trip.

The reproducible-build verification is a separate step — see
[`tools/build-reproduce/`](../build-reproduce/) and
[`docs/REPRODUCIBLE_BUILDS.md`](../../docs/REPRODUCIBLE_BUILDS.md).

## Status today

- ✅ Directory + scripts exist and are reachable from `CONTRIBUTING.md` and `docs/VERIFY-RELEASE.md`.
- ⏸ Actual GPG signing pending G180 (release key publication).
- ⏸ CI integration pending G005 / G157 (no-CI-during-build-phase memory rule).
- ⏸ SHA-256 publication via `RELEASE_HASHES.md` in-repo pending G159.
- ⏸ Cross-platform reproduce (macOS / Windows pre-signing artifacts) pending the desktop reproducibility follow-ups.

The "until then" path: maintainer publishes hashes manually, users
verify via `sha256sum -c` against the manifest pulled from the
release page. Everything except the trust-rooting GPG step is live.
