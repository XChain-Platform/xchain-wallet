# Verify a release — XChain Wallet

This is the user-facing recipe for verifying that a release artifact
you downloaded was produced from the source tree at a specific git
tag, and was signed by the project maintainer's release key.

If you only want a one-line answer: clone the repo, run the platform's
reproduce script, compare hashes, then verify the GPG signature on the
hash manifest. The detail below walks you through each step.

**Spec reference:** §51 of `XCHAIN_WALLET_SPEC.md` — Build and Release
Per Target. **Companion docs:** [`docs/REPRODUCIBLE_BUILDS.md`](REPRODUCIBLE_BUILDS.md)
(what we promise + how we made the bytes deterministic), [`SECURITY.md`](../SECURITY.md)
(disclosure policy + release key fingerprint).

---

## What you're checking

Three independent claims combine into a real verification:

1. **Bit-for-bit reproducibility** — rebuilding from a tagged commit
   produces the same pre-signing artifact bytes that the maintainer
   signed for that tag.
2. **Hash integrity** — the SHA-256 of the artifact you downloaded
   matches the hash the maintainer published for that tag.
3. **Signature authenticity** — the maintainer's release GPG key
   signed the hash manifest, and that key matches the fingerprint
   published in [`SECURITY.md`](../SECURITY.md).

You need **all three** to claim verification. Skipping signatures
trusts the download host. Skipping hashes trusts the build environment.
Skipping reproducibility trusts that the maintainer's machine wasn't
compromised between source and signing.

---

## Prerequisites

- `git`
- `gpg` (a working GnuPG install — `gpg --version` should show 2.x)
- `sha256sum` (Linux) / `shasum -a 256` (macOS)
- For desktop reproducibility: `docker` (the reproduce container
  pins toolchain versions so you don't need to install Node / pnpm
  locally)

Anything beyond that depends on the target you're verifying.

---

## Step 1 — Import the maintainer's release key

The release key fingerprint is published in [`SECURITY.md`](../SECURITY.md).
Until G180 lands the fingerprint is "to be published alongside the
first GPG-signed release artifact"; once published, you can fetch it
from a keyserver:

```bash
gpg --keyserver keys.openpgp.org --recv-keys <FINGERPRINT>
gpg --fingerprint <FINGERPRINT>
```

Cross-check the fingerprint output against `SECURITY.md`. They must
match exactly. If they do not, **stop** and ask in a public channel
before proceeding — a mismatching fingerprint is the canonical sign
that your view of either the keyserver or the doc is compromised.

If you already have the key from a prior verification, you do not
need to re-import.

---

## Step 2 — Download the artifact and its signature

Every release tag publishes:

- The artifact (`.dmg`, `.exe`, `.AppImage`, `.deb`, `.zip` for
  extension stores).
- `RELEASE_HASHES.txt` — SHA-256 manifest of every artifact in the
  release.
- `RELEASE_HASHES.txt.asc` — GPG signature on the manifest.

```bash
TAG=vX.Y.Z
BASE="https://github.com/XChain-platform/xchain-wallet/releases/download/${TAG}"
curl -fsSLO "${BASE}/RELEASE_HASHES.txt"
curl -fsSLO "${BASE}/RELEASE_HASHES.txt.asc"
curl -fsSLO "${BASE}/<artifact-filename>"
```

Use the artifact filename appropriate for your platform.

---

## Step 3 — Verify the signature on the hash manifest

```bash
gpg --verify RELEASE_HASHES.txt.asc RELEASE_HASHES.txt
```

You want to see "Good signature from ..." and a key fingerprint that
matches the one in `SECURITY.md`. A "WARNING: This key is not certified
with a trusted signature" line is normal unless you've explicitly
trust-signed the key locally — read the fingerprint regardless.

If verification fails: stop. Do not run the artifact. Open a thread
with the project maintainers — either the manifest or the signature
(or both) was tampered with.

---

## Step 4 — Verify the artifact hash

```bash
# Linux / Windows (Git Bash, WSL)
sha256sum -c <(grep "<artifact-filename>" RELEASE_HASHES.txt)

# macOS
shasum -a 256 -c <(grep "<artifact-filename>" RELEASE_HASHES.txt)
```

You want to see `<artifact-filename>: OK`. A `FAILED` line means the
file you downloaded does not match the hash the maintainer published —
likely a corrupt download (rare) or a tampered mirror (rare but
serious).

At this point the artifact has been authenticated. You can install
or run it.

---

## Step 5 (optional but recommended) — Reproduce the build

A passing signature plus matching hashes prove that the maintainer
released what they signed. Reproducing the build proves that what they
signed is what the source produces — closing the loop against a
maintainer-machine compromise.

### Desktop (Linux)

```bash
git clone https://github.com/XChain-platform/xchain-wallet.git
cd xchain-wallet
git checkout ${TAG}
bash packages/desktop/scripts/reproduce.sh ${TAG}

diff reproduce-out/RELEASE_HASHES.txt RELEASE_HASHES.txt
```

A zero-byte diff means the artifact matches what source produces.
Any diff is diagnostic — see the desktop doc's
[diagnostics section](../packages/desktop/REPRODUCIBLE_BUILDS.md)
("Toolchain drift / Timestamp leakage / Supply-chain tampering").

### Desktop (macOS / Windows)

Cross-platform reproduction is not yet wired (§51 follow-up). Until
that lands, the per-platform `RELEASE_HASHES.txt` entry plus the GPG
signature on the manifest is the available integrity guarantee for
those targets.

### Extension and web

Per-release reproduce scripts for the extension `.zip` and the web
SPA bundle ship alongside the broader release-signing infrastructure
(tracked under §51 as G158 / G159 / G160 in the gap ledger). Until
they land, the extension store's signing pipeline and the web SPA's
SRI hashes are the available integrity guarantees for those targets.

---

## What "verified" means and does not mean

A verified release means: the bytes you installed correspond to the
source tree at a specific git tag, signed by the maintainer's release
key. It does NOT mean:

- **The source code itself is bug-free.** Read it; audit it; or rely
  on independent reviews.
- **The maintainer's release key has not been compromised.** Watch for
  key-rotation announcements in `SECURITY.md` and on the release page.
- **Upstream dependencies are safe.** The reproducible-build pipeline
  pins versions but does not audit them. The Electron framework
  (desktop) and Chromium (web) trust chains live upstream.
- **Every locale / chain / signer behaves correctly.** That is what
  testing + the QA checklist (`docs/QA-CHECKLIST.md`) cover.

Verification protects against tampering between source and download.
It is one defensive layer among many.

---

## Reporting a verification failure

A signature failure or hash mismatch is a security event. Please file
it via the channels in [`SECURITY.md`](../SECURITY.md) — preferably
GitHub's private vulnerability reporting, with the failing artifact
URL, the SHA-256 you computed, and the GPG output. Do not post in a
public issue first.
