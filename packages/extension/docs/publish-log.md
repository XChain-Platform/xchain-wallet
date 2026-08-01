<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright © 2026 Dankest, LLC -->

# Chrome Web Store publish log

**Status:** SCAFFOLD. No real publish has happened yet; the row below is a worked EXAMPLE only, not a real entry.  
**Last updated:** 2026-07-31  
**Source item:**  (`claude/specs/wallet-publishing-chrome-extension.md`), §2 "Publish monitoring", stage S1.  
**Canonical item name:** `io.xchain.wallet.extension` (spec §2, decided 2026-07-31), matching the desktop `io.xchain.wallet.desktop`, Android `io.xchain.wallet.android`, and iOS `io.xchain.wallet.ios`. This is the name we use for the item in writing. It is not the Chrome extension ID: Chrome derives that from the item's public key at first upload, and it goes in the row below and in the rails K7 row once it exists.  
**Store-assigned extension IDs:** main `<pending first upload>`, beta `<pending first upload>`.

## Purpose and rule of use

Every time the release operator uploads a build to the Chrome Web Store console (either item: main or beta), they append one row to this file, in the same step as the upload, before moving on. Nothing secret goes in this file: no OAuth tokens, no console passwords, no recovery codes. It is a plain public-safe record of what was published, by whom, and when.

The stage-S5 store-version monitor (`tools/release/store-version-monitor.mjs`, built; NOT yet installed as a origin-host cron - see that script's own header and `tools/release/README.md` "Installing the store-version monitor on origin-host" for the install steps) reads this file and compares it against the live version the Chrome Web Store actually serves for each item. **The rule the monitor enforces: a live store version that has no matching row in this log is the rogue-publish incident signal.** That is the whole reason this file exists: someone (or something) put a version live through the console without it going through the logged, one-operator-per-release process in spec §6, which is exactly the failure mode a compromised or phished publisher account produces.

Do not compare a live version against "the latest release tag" instead of this log: the store lawfully lags the git tag during review, and after a rejection the live version can be older than the tag for a while. Comparing against the tag would false-alarm on every normal release and teach everyone to ignore the alert.

## Columns

| version | zip sha256 | item (main/beta) | operator | date |
|---|---|---|---|---|

- **version:** the `version` string from the uploaded `manifest.json` (matches `xchain-wallet-extension-vX.Y.Z.zip`).
- **zip sha256:** sha256 of the exact zip uploaded, checked against the tag's `RELEASE_HASHES.txt` entry before upload (spec §6). Not a secret; safe to record in full.
- **item:** which CWS item this went to: `main` (public/unlisted listing) or `beta` (the second unlisted soak item, per spec §4).
- **operator:** the named release operator who claimed this release in the ledger before touching the console (spec §6 "one operator per release").
- **date:** the date the upload was submitted through the console (not the date it clears review; review status is tracked separately, see `store-correspondence.md` if a rejection happens).

## Log

| version | zip sha256 | item | operator | date |
|---|---|---|---|---|
| 0.0.0-EXAMPLE | `0000000000000000000000000000000000000000000000000000000000000000` | main | EXAMPLE-operator (not a real entry) | 2026-01-01 |
