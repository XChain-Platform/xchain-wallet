# Verify a release - XChain Wallet

This is the user-facing recipe for verifying that a release artifact
you downloaded was produced from the source tree at a specific git
tag, and was signed by the project maintainer's release key.

If you only want a one-line answer: clone the repo, run the platform's
reproduce script, compare hashes, then verify the GPG signature on the
hash manifest. The detail below walks you through each step.

**Spec reference:** §51 of `XCHAIN_WALLET_SPEC.md` - Build and Release
Per Target. **Companion docs:** [`docs/Reproducible_Builds.md`](Reproducible_Builds.md)
(what we promise + how we made the bytes deterministic), [`SECURITY.md`](../SECURITY.md)
(disclosure policy + release key fingerprint).

---

## What you're checking

Four independent claims combine into a real verification:

1. **Bit-for-bit reproducibility** - rebuilding from a tagged commit
   produces the same pre-signing artifact bytes that the maintainer
   signed for that tag.
2. **Hash integrity** - the SHA-256 of the artifact you downloaded
   matches the hash the maintainer published for that tag.
3. **Signature authenticity** - the maintainer's release GPG key
   signed the hash manifest, and that key matches the fingerprint
   published in [`SECURITY.md`](../SECURITY.md).
4. **Release identity** - the manifest says, inside the signed bytes,
   which release it describes. A genuine manifest from a *different*
   release passes claims 2 and 3 perfectly, so without this one you can
   be handed an older signed release and never know.

You need **all four** to claim verification. Skipping signatures
trusts the download host. Skipping hashes trusts the build environment.
Skipping the identity check trusts that nobody swapped one signed
release for another. Skipping reproducibility trusts that the
maintainer's machine wasn't compromised between source and signing.

**The short version.** `tools/release/verify.sh` does claims 2, 3 and 4
in one command, and is the same script the maintainer runs before
publishing:

```bash
bash tools/release/verify.sh --input <download-dir> --tag vX.Y.Z
```

The manual walk-through below exists so you can check each claim
yourself without trusting our script either.

---

## Prerequisites

- `git`
- `gpg` (a working GnuPG install - `gpg --version` should show 2.x)
- `sha256sum` (Linux) / `shasum -a 256` (macOS)
- For desktop reproducibility: `docker` (the reproduce container
  pins toolchain versions so you don't need to install Node / pnpm
  locally)

Anything beyond that depends on the target you're verifying.

---

## Step 1 - Import the maintainer's release key

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
before proceeding - a mismatching fingerprint is the canonical sign
that your view of either the keyserver or the doc is compromised.

If you already have the key from a prior verification, you do not
need to re-import.

---

## Step 2 - Download the artifact and its signature

Every release tag publishes:

- The artifact (`.dmg`, `.exe`, `.AppImage`, `.deb`, `.zip` for
  extension stores).
- `RELEASE_HASHES.txt` - SHA-256 manifest of every artifact in the
  release.
- `RELEASE_HASHES.txt.asc` - GPG signature on the manifest.

```bash
TAG=vX.Y.Z
BASE="https://github.com/XChain-platform/xchain-wallet/releases/download/${TAG}"
curl -fsSLO "${BASE}/RELEASE_HASHES.txt"
curl -fsSLO "${BASE}/RELEASE_HASHES.txt.asc"
curl -fsSLO "${BASE}/<artifact-filename>"
```

Use the artifact filename appropriate for your platform.

The manifest is also published under its versioned name,
`RELEASE_HASHES/vX.Y.Z.txt`. Prefer that one: the filename then states
which release the manifest is for, and `verify.sh` checks it against
what the manifest says about itself with no `--tag` needed. If you take
the plain `RELEASE_HASHES.txt`, pass `--tag vX.Y.Z` so the same check
can still run - `verify.sh` refuses to call a manifest verified when
nothing says which release it belongs to.

---

## Step 3 - Verify the signature on the hash manifest

```bash
gpg --verify RELEASE_HASHES.txt.asc RELEASE_HASHES.txt
```

You want to see "Good signature from ..." and a key fingerprint that
matches the one in `SECURITY.md`. A "WARNING: This key is not certified
with a trusted signature" line is normal unless you've explicitly
trust-signed the key locally - read the fingerprint regardless.

If verification fails: stop. Do not run the artifact. Open a thread
with the project maintainers - either the manifest or the signature
(or both) was tampered with.

---

## Step 4 - Verify the artifact hash

```bash
# Linux / Windows (Git Bash, WSL)
sha256sum -c <(grep "<artifact-filename>" RELEASE_HASHES.txt)

# macOS
shasum -a 256 -c <(grep "<artifact-filename>" RELEASE_HASHES.txt)
```

You want to see `<artifact-filename>: OK`. A `FAILED` line means the
file you downloaded does not match the hash the maintainer published -
likely a corrupt download (rare) or a tampered mirror (rare but
serious).

The manifest begins with `#` header lines. `shasum -c` ignores them;
GNU `sha256sum -c` reports "N lines are improperly formatted" and
carries on, which is noise, not a problem. Strip them if you would
rather not read it:

```bash
grep -v '^#' RELEASE_HASHES.txt | grep "<artifact-filename>" | sha256sum -c -
```

One caveat worth knowing if you are checking the whole manifest at
once: macOS ships a `/sbin/sha256sum` that prints that warning and then
**exits 0 even when every line was malformed and nothing was checked**.
Read the `: OK` lines, not just the exit code. (`verify.sh` rejects
malformed lines itself rather than trusting either tool.)

---

## Step 4b - Check which release the manifest describes

```bash
head -8 RELEASE_HASHES.txt
```

```
# XChain Wallet release manifest
# manifest-version: 1
# tag: v0.333.1
# tag-commit: 9f3c...
# built: 2026-07-31T18:02:11Z
# dev-mock-gate: enforced
# artifacts: 8
```

These lines are inside the signed bytes, so a good signature vouches
for them too. Three things to read:

- **`tag`** must be the release you meant to download. A manifest
  lifted from another release hashes and verifies perfectly; this line
  is the only thing that catches it.
- **`tag-commit`** is the commit the tag resolved to at signing time.
  Use it for the reproduce step below.
- **`dev-mock-gate`** must say `enforced`. Anything else means the
  release was signed without the check that keeps the development stub
  SDK - which shows fabricated addresses and cannot really sign - out
  of a shipped bundle. Treat that as a reason to ask before installing.

At this point the artifact has been authenticated. You can install
or run it.

---

## What the signature proves, per surface

Byte-exact verification is only possible for artifacts served from our
own download host. Three of the four store surfaces re-package or
re-sign what we submit, so for those the manifest proves **what was
submitted, not what was delivered to you**. This is a property of the
stores, not something we can close:

| Where you got it | What the manifest proves |
|---|---|
| downloads.xchain.io (web tarball, desktop installers) | Everything above: the bytes you have are the bytes we signed. |
| Chrome Web Store | The store repacks our zip into a store-signed CRX. You cannot hash the CRX against our manifest; comparison is content-level at best. The store's own signature is what protects delivery. |
| Google Play | Play re-signs and derives per-device APKs from the AAB we upload. Nothing you receive hashes to our manifest. |
| App Store | Apple re-encrypts and thins the ipa. App Store users cannot hash what they were served. |

If byte-exact verification matters to you, take the artifact from
downloads.xchain.io rather than from a store.

---

## Step 5 (optional but recommended) - Reproduce the build

A passing signature plus matching hashes prove that the maintainer
released what they signed. Reproducing the build proves that what they
signed is what the source produces - closing the loop against a
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
Any diff is diagnostic - see the desktop doc's
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
  testing + the QA checklist (`docs/QA_Checklist.md`) cover.

Verification protects against tampering between source and download.
It is one defensive layer among many.

---

## Reporting a verification failure

A signature failure or hash mismatch is a security event. Please file
it via the channels in [`SECURITY.md`](../SECURITY.md) - preferably
GitHub's private vulnerability reporting, with the failing artifact
URL, the SHA-256 you computed, and the GPG output. Do not post in a
public issue first.
