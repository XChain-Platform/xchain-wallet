# Reproducible builds - @xchain-wallet/extension

XChain Wallet aims for **Level-2 reproducibility of the pre-submission
artifact** per §51 of `XCHAIN_WALLET_SPEC.md`. Any independent verifier
can rebuild the Chrome MV3 extension from source and produce the exact
same unpacked `packages/extension/dist/` bundle that the maintainer
submits to the Chrome Web Store. Combined with the published
`RELEASE_HASHES.txt` for each tag, that closes a real verification loop
for the unpacked bundle.

This document describes the protocol: what we promise, what we
explicitly don't, and how to verify a release.

---

## What's reproducible

- **The unpacked MV3 bundle** produced by `pnpm --filter
  @xchain-wallet/extension build` (Vite production build) under
  `packages/extension/dist/`: popup, service worker, content script,
  inject script, `manifest.json`, and resized icons.
- **The SHA256 of every file in that directory** as captured in
  `RELEASE_HASHES.txt` (emitted by `scripts/build.sh`).

## What's NOT reproducible

- **The published `.crx`.** The Chrome Web Store re-packages and
  re-signs the extension server-side; the store-delivered `.crx` embeds
  a Google-issued signature and will never be byte-for-byte identical to
  a locally built one. Reproducibility here covers the **pre-store
  unpacked bundle** - the content going into submission - not the store
  output. This is a Web-Store-ecosystem-wide constraint, not an
  XChain-specific gap.
- **Icon rasterization drift.** Icons are resized from source SVG/PNG by
  `sharp` at build time. `sharp` normally resolves a prebuilt binary
  pinned by the lockfile; the reproduce image keeps a C/C++ toolchain
  present so a fallback source build stays deterministic rather than
  failing the reproduction.
- **Anything on a host that is not amd64, natively.** The pinned base
  image digest resolves to `linux/amd64` and nothing else, and
  `reproduce.sh` passes `--platform linux/amd64` explicitly so that is a
  stated cost rather than a surprise. This is deliberate and matches the
  desktop shell: the release lane runs on an amd64 runner, so an arm64
  container would faithfully reproduce a build we never cut. See the
  prerequisites below - on arm64 this is a real setup step, not a note.

## Verification protocol

Prerequisites: Docker, git, bash.

**On arm64 (Apple Silicon, arm64 Linux) you also need working amd64
emulation**, because the image is amd64-only by design. Docker Desktop
ships it; a plain Docker Engine on arm64 Linux does not, and without it
this reproduction fails with a bare `exit code: 133` from the Node
install layer - an exec-format error that names no cause and reads like
a broken script rather than a missing prerequisite. Register it once:

```bash
docker run --privileged --rm tonistiigi/binfmt --install amd64
```

Expect a substantial speed penalty under emulation. This is stated here
because the failure mode is silent and misleading: before 2026-08-02 the
extension's `reproduce.sh` did not pass `--platform` at all, so an arm64
verifier built an arm64 image and hit exactly that opaque failure with
nothing pointing at the cause.

**`qemu` alone is not sufficient for THIS lane, and the reason is
specific.** Measured 2026-08-02 on arm64 Linux with `qemu-x86_64`
registered: the image builds, `pnpm install` resolves all 866 packages,
and the build then dies inside `esbuild` with a **Go runtime crash**
(`[vite:define] The service was stopped`, preceded by a goroutine
traceback out of `esbuild/pkg/api.Transform`). esbuild ships a static Go
binary, and Go's runtime is one of the things qemu user-mode emulation
handles worst. The desktop lane's note that emulated reproduction "works,
at a speed penalty" was measured on a lane that does not run esbuild
through qemu in the same way; do not read it as covering this one.

So on arm64 the reliable routes are, in order:

1. **Docker Desktop on Apple Silicon**, which emulates amd64 with Rosetta
   rather than qemu and runs Go binaries correctly.
2. **Any amd64 Linux host with Docker** - which is also what the release
   lane itself is, so it is the closest thing to an apples-to-apples
   comparison a verifier can run.

A plain `qemu` setup will get you a crash that looks like a broken build
script and is not one.

```bash
# From anywhere inside the repo:
bash packages/extension/scripts/reproduce.sh v0.334.0 ./verify-out

# Or via the package script (builds current HEAD):
pnpm --filter @xchain-wallet/extension reproduce
```

The script checks out the tag in an isolated worktree, builds the
digest-pinned image, runs the in-container build, and prints the
resulting `RELEASE_HASHES.txt`. Diff it against the official manifest
published with the release tag. Expect the unpacked bundle to match; the
store-published `.crx` will not.

The in-container build also runs `tools/build-reproduce/check-no-dev-mock.sh`,
so a bundle that reached the dev-mock SDK fallback fails before a manifest
is ever emitted.
