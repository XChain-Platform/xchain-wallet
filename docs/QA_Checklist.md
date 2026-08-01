# XChain Wallet - Manual QA Checklist

Pre-release sanity check. Automated suites (smokes, vitest, Playwright, repro-build) cover code correctness; this checklist covers feature correctness - does the wallet actually behave the way a user expects when they hold it.

Run this against every shell (web, extension, desktop) before tagging a release. Skip a section only with a written note in the release CHANGELOG explaining why (e.g., "extension only - no desktop changes this cycle").

**Status icons:**

- ✅ Passed
- ⬜ Not yet checked
- ❌ Failed (open issue + reference here)
- ⏸ Skipped (note why)

---

## Pre-flight

- ⬜ `pnpm install` succeeds against a fresh checkout, sibling `xchain-sdk` present.
- ⬜ `node test/smoke/_run-smokes.js` reports the documented baseline (24 / 171 as of v0.194.0; update this checklist if the baseline shifts).
- ⬜ `pnpm typecheck` is clean.
- ⬜ `git status` is clean against the tagged commit (no stray edits, no `node_modules` drift).
- ⬜ `CHANGELOG.md` has a `## [x.y.z]` entry for the release with a meaningful summary.
- ⬜ `WALLET_VERSION` in `packages/core/src/buildInfo.js` matches every `package.json`.
- ⬜ `SECURITY.md` link in About panel resolves (`buildInfo.SECURITY_PUBLISHED === true`).

---

## Onboarding

Run on a clean profile (extension: fresh install / clear `chrome.storage`; web: incognito; desktop: clean `userData/`).

- ⬜ License agreement gate appears on first launch.
- ⬜ License-accept checkbox is disabled until the panel is scrolled to the end.
- ⬜ Once accepted, license gate does not reappear on subsequent launches.
- ⬜ Create wallet - 12-word selection - recovery phrase displayed, copy works, verify-quiz mismatch surfaces the offending word.
- ⬜ Create wallet - 24-word selection - same as above; verify-quiz scales position count.
- ⬜ BIP39 passphrase advanced toggle: matched-pair input, permanent-loss warning visible, threaded into vault.
- ⬜ Import recovery phrase - typed input, drag-drop `.txt`, scan QR (where camera is available).
- ⬜ Import encrypted backup `.xchain-wallet` - file picker + paste both work; backup password unlocks the file.
- ⬜ Try-before-commit demo mode - entry button works; demo banner mounts; "Exit demo & wipe" clears the wallet.
- ⬜ ADS onboarding consent screen surfaces during create (extension + web; desktop where applicable).

---

## Send

- ⬜ Send native coin (BTC / DOGE / LTC) - address paste, amount entry, fee selector.
- ⬜ Send token - picker shows pinned + visible tokens; hidden hidden until expanded.
- ⬜ Recipient autocomplete from contacts + history.
- ⬜ Address paste runs through paste-integrity check (clipboard hijack rejected).
- ⬜ Lookalike-address banner fires when an address closely resembles a recent recipient with one differing character.
- ⬜ Test-send protection prompts on a never-used recipient.
- ⬜ Fiat / token amount toggle works; `Max` button populates the form.
- ⬜ Custom fee mode shows DOGE per-kB unit-aware input.
- ⬜ RBF toggle defaults from settings; enabling it surfaces the speed-up affordance in History.
- ⬜ Broadcast success - pending card with txid, copy works, explorer link opens.
- ⬜ Broadcast cancel from HW - "Transaction cancelled." toast, return to form, no half-state.

## Receive

- ⬜ Address QR renders, copy works.
- ⬜ "Request payment" sub-form generates a BIP21 URI, share button posts to the OS share sheet (where supported).

---

## History

- ⬜ Activity feed loads; skeleton rows show during the initial fetch, replaced when data lands.
- ⬜ Empty-state nudge with Receive CTA renders for an unused address.
- ⬜ Filter chips (action type, status, date) work alone and combined.
- ⬜ Search box filters by tick / address / txid substring.
- ⬜ Grouped mode collapses ISSUE+MINT, DISPENSER+DISPENSE, ORDER+fills.
- ⬜ Tx detail expands; status timeline shows Broadcast / Mempool / Confirmed.
- ⬜ Export CSV / JSON respects active filters; downloaded file opens correctly.

---

## Token detail

- ⬜ Clicking a balance row from Home opens TokenDetail.
- ⬜ "View activity" lands History pre-filtered to the asset.
- ⬜ Star toggle moves the token to the pinned section on Home.
- ⬜ Hide toggle moves it under "Show N hidden tokens".

---

## Sign screens

- ⬜ Send sign approval - plain-English summary shows `to`, `amount`, `asset` as the user typed them.
- ⬜ Balance-change preview accurate for SEND.
- ⬜ Raw PSBT viewer expands; bytes match the hex copy.
- ⬜ User-initiated Sign Message - text → signature → verify with same address succeeds.
- ⬜ User-initiated Verify Signature - paste signature/address/message → ok / not-ok rendered correctly.
- ⬜ User-initiated PSBT paste-in form - paste hex → preview → sign → signed PSBT hex output.

---

## Lock, unlock, panic

- ⬜ Auto-lock fires after the configured timeout (default 15 min); session key cleared.
- ⬜ Auto-lock still fires when the wallet is left on a screen other than Home: set the timeout to 1 minute, open Send and half-fill it, idle 90 seconds, confirm it locks. Repeat on Receive, History and Settings .
- ⬜ Auto-lock set to "Never" does not lock, however long the wallet idles.
- ⬜ Manual lock action returns to Locked screen.
- ⬜ Failed-attempts escalating delay kicks in after 3 failed unlocks; banner counts down.
- ⬜ Caps-lock warning appears when caps is active in the password field.
- ⬜ Privacy blur engages on window blur (extension + desktop).
- ⬜ Biometric unlock works on supported devices (WebAuthn PRF).
- ⬜ Panic mode arms - sign attempts reject with `PANIC_MODE`; 24h countdown visible in Settings.
- ⬜ Duress passphrase silently arms panic mode and shows a decoy wallet.

---

## Backup and recovery

- ⬜ Encrypted backup export - file downloads with `.xchain-wallet` extension; size > 0.
- ⬜ Reveal seed phrase - password gate, tap-to-reveal, words match what was created.
- ⬜ Dry-run restore - paste mnemonic → preview accounts/addresses without writing.
- ⬜ Publish labels now - FILE action broadcasts (software wallets only).
- ⬜ Backup-reminder card surfaces on Home for an unverified wallet; "Back up now" routes to the right place.

---

## Hardware signers

Run with a real Trezor and Ledger device. Skip the row + add a note if a device isn't available.

- ⬜ Trezor pair flow opens Trezor Connect; address derived correctly.
- ⬜ Ledger pair flow opens WebHID picker; address derived correctly.
- ⬜ Signer-select form appears when adding accounts/addresses; HW path skips the wallet password.
- ⬜ Send via HW signer - full sign + broadcast round-trip.
- ⬜ Show Private Key surface is unavailable for HW addresses (gating enforced).

---

## Multisig

- ⬜ Create n-of-m config from Settings → Multisig.
- ⬜ PSBT-QR cosigner round-trip (animated frames + manual stepping under reduced motion).
- ⬜ Paste-inbox accepts partial PSBT hex; combiner finalizes once threshold is reached.

---

## dApp bridge

Use `packages/test-dapp/` against the extension under test.

- ⬜ `connect()` opens the approval popup; user can narrow chains.
- ⬜ Approval popup is OS-rendered (not in-page DOM).
- ⬜ `getAccounts` / `getBalances` return after connect.
- ⬜ `signMessage` round-trip - verifiable signature.
- ⬜ `signAction({ action: 'SEND' })` - approval, sign, broadcast.
- ⬜ `signIn` round-trip - challenge parses, signature verifies.
- ⬜ `disconnect` fires the `disconnect` event back to the provider; `accountsChanged` fires when the user revokes from Settings.
- ⬜ `Connected Sites` settings panel shows the test dApp; revoking removes it; revoke fires `disconnect`.

---

## Offline / degraded mode

- ⬜ Disable network - `ReachabilityBanner` appears within 30s.
- ⬜ Attempt a Send while offline - broadcast fails, banner remains; queued-broadcast UI shows the entry (where wired).
- ⬜ Re-enable network - banner clears; queue prompt appears (when wired).
- ⬜ `StalenessLabel` updates correctly across surfaces that mount it.

---

## Accessibility

- ⬜ Tab from the unlocked Home reveals the skip-to-main-content link as the first focusable element.
- ⬜ Every form has a visible focus ring on inputs, buttons, and clickable primitives (CopyButton, AddressText, etc.).
- ⬜ Status / error / success messages announce via `aria-live`.
- ⬜ `prefers-reduced-motion` clears entrance animations on Onboarding.
- ⬜ `prefers-contrast: more` palette is readable end-to-end.
- ⬜ Forced-colors mode (Windows high contrast) renders without obvious layout breakage.

---

## URI schemes

- ⬜ `xchain:<address>` opens the wallet (web shell registers via `navigator.registerProtocolHandler`).
- ⬜ Extension popup deep-link opens with the URI as a routable intent (where wired).
- ⬜ Desktop `xchain:` URI from the OS opens the wallet on macOS / Windows / Linux.
- ⬜ `pnpm test:fuzz` includes `test/fuzz/harness/xchain-uri.fuzz.js` and is green. The
  harness is the standing guard for the audit recorded below; a release that
  skips it has not checked the wallet's widest untrusted-string surface.

### Deep-link input audit ( §3.6)

Run before a Chrome Web Store submission that touches the URI parser, the
Send route, or the EXECUTE route. `popup.html?uri=` is a live boot path that
survives the unlock cycle, and the camera scan route feeds the same parser,
so whatever survives it lands in screen state.

**Audit of record: 2026-07-31, against `packages/core/src/uri/xchainUri.js`
at commit 827a74c3.** Method: the fast-check harness above (12 properties,
200 runs each) plus a 31-case hand-driven hostile corpus. Result: the
store-review question is answered YES, a crafted link opens a compose view
and nothing more. Recorded so the next auditor can tell drift from a fresh
finding:

- ✅ Total function. No input throws, including non-strings; every result
  carries one of the four documented kinds.
- ✅ A link cannot start a signing flow. `Send`'s stage state initializes to
  the literal `'form'` and the only transitions to review / confirm sit
  inside the submit handler, so a prefill cannot begin past compose. The
  popup's boot effect sets prefill state and a view and calls nothing else.
- ✅ Routing values are gated. A hostile `chainId` from either the legacy
  path form or the BIP21 `chain=` param is dropped rather than carried; the
  EXECUTE contract index and gas limit are digits-only; `feePriority` is one
  of three tiers or absent.
- ✅ Send-shaped fields (`to` / `amount` / `tick` / `memo`) never populate an
  EXECUTE intent, so one link cannot arm both forms.
- ✅ No prototype pollution from any query key, `__proto__` and
  `constructor` included; `Object.prototype` is unchanged after the corpus.
- ✅ BIP21 `req-` params reject the whole URI, including percent-encoded
  spellings (`%72eq-x`, `r%65q-x`).
- ✅ Oversized input stays bounded. 500KB in each gated position parses well
  under the 2s harness ceiling; the gate regexes are anchored and
  length-bounded, so there is no backtracking blowup.

Two findings, both recorded rather than fixed, neither blocking submission:

- ⬜ **Deep-link fields skip the repo's own display hardening.** `memo`,
  `tick`, `address`, and the EXECUTE `method` / `params` carry attacker-
  supplied text to a signing surface unneutralized: U+202E and a CRLF
  survive into `memo`, a NUL survives into `tick`. `safeOutcomeLabel` in
  `packages/core/src/shared/utils/betOutcomeLabels.js` already implements
  exactly the neutralization this wants (bidi controls to a visible
  placeholder, zero-width and control characters dropped, whitespace
  collapsed, length capped), and its header comment gives the reason:
  attacker-controlled strings land on a signing screen. It is simply not
  applied here. Bounded by the fact that the user sees and can edit these
  fields in the compose form before confirm, which is why this is a
  hardening gap and not a blocker.
- ⬜ **An unrecognized action segment silently becomes a send.** By design
  (`xchainUri.js` treats anything outside the receive / execute sets as
  `kind: 'send'` and preserves the literal in `intent.action`), so
  `xchain:BTC/drainwallet?...` and `xchain:BTC/approve?...` both route to
  the Send compose form. Harmless while the shells route on `kind`. It
  becomes a real hazard the moment any screen routes on `intent.action`,
  because a typo'd or invented segment would then reach that screen. Treat
  "shells route on `kind`, never on `action`" as the invariant that keeps
  this safe, and re-check it whenever a new deep-link route is added.

---

## Build and release artifacts

- ⬜ `pnpm --filter @xchain-wallet/web build` produces a deployable `dist/`.
- ⬜ `pnpm --filter @xchain-wallet/extension build` produces an unpacked dist that loads as an MV3 extension.
- ⬜ `pnpm --filter @xchain-wallet/desktop dist` produces signed installers for the target platform.
- ⬜ `pnpm --filter @xchain-wallet/desktop dist:unpacked` produces the reproducible Linux bundle.
- ⬜ `pnpm --filter @xchain-wallet/desktop reproduce` runs and matches `RELEASE_HASHES.txt`.
- ⬜ Diagnostic dump (About → Copy diagnostics) produces JSON with the new version stamped.

### Remote-code audit of the built extension bundle ( §3.2)

- ⬜ `pnpm --filter @xchain-wallet/extension audit:remote-code` exits 0 against a
  fresh build. Run it before any submission that changes dependencies or the
  build.

Manifest V3 bans remotely-hosted code outright, and it is the first thing a
Chrome Web Store reviewer checks on a wallet. The command above
(`packages/extension/scripts/remote-code-audit.mjs`) scans every shipped
`.js` / `.html` / `.css` / `.json` in `dist/` for `eval`, the `Function`
string constructor, `importScripts`, dynamic `import()`, script-element `src`
assignment to a remote URL, and `WebAssembly.instantiateStreaming` /
`compileStreaming`. It is a gate rather than a report: the three known-benign
hits below are allow-listed in the script by code signature (not by filename,
since Vite chunk names carry a content hash), and anything else exits
non-zero. A new hit is either a real violation that blocks submission, or a
new benign pattern that belongs in the script's `ALLOWED` list with its
reason written out. Do not waive one by deleting the check.

**Audit of record: 2026-07-31, 21 shipped text files.** The MV3 remote-code
claim holds: nothing in the bundle fetches or evaluates code at runtime. The
three static-scan hits below are all benign, and they are written down
because a reviewer's own scanner will surface the same three and the operator
should not have to re-derive the answer under a review clock:

- `content/contentScript.js` creates a `<script>` element whose `src` is
  `chrome.runtime.getURL('inject/xchainProvider.js')`. A packaged local
  resource, not a remote one; this is the provider injection the listing
  pack's content-script justification describes.
- `chunks/wallet-*.js` contains `Function("binder", "return function ...")`
  from the bundled `function-bind` shim. Dead in Chrome, which has had
  `Function.prototype.bind` since forever, and blocked at runtime anyway by
  MV3's default `script-src 'self'`. Worth pruning the dependency to remove
  the flag entirely, but it is not a violation.
- `chunks/chromeMessaging-*.js` contains React DOM's well-known
  `innerHTML = "<script><\/script>"` element-creation workaround. React
  internals, and likewise inert under the MV3 CSP.

Watch the absolute-origin inventory the same scan produces. Every host that
the shipped code can actually contact at runtime must appear in
`packages/extension/PRIVACY_POLICY.md` and must match what the operator ticks
in the store's data-disclosure tab; spec §3.3 names that mismatch as a common
rejection cause. As of this audit the runtime set is: the configured
blockchain RPC and XChain decoder / indexer / explorer endpoints;
`api.coingecko.com` (Settings → Privacy, "Native coin price data", default
on); TIS token-metadata document hosts and the embedded media they reference,
including the `ipfs.io` and `arweave.net` gateways (Settings → Privacy,
"Fetch token metadata", default on); and the external block-explorer favicons
rendered on History detail (`mempool.space`, `blockstream.info`,
`blockchair.com`, `litecoinspace.org`, `blockcypher.com`), which have no
toggle. Everything else
the scan reports is an inert documentation, licence, or demo-fixture string.

### Chrome Web Store release provenance ( §6)

Run before every Chrome Web Store upload (first submission, a beta-lane
soak build, or a public update). The manifest-freeze rules below run
automatically in `pnpm test:smoke` (`packages/core/scripts/extension-manifest-audit.js`,
checked against `packages/extension/docs/manifest-freeze.json`) and gate
the release build; the two rows after them are steps a human does, not
things a script can do for you.

- ⬜ **Privacy-policy URL is live, before the store submission form is even
  opened ( §5 D5).** The listing points reviewers at
  `https://xchain.io/wallet/privacy/`, and the CWS submission form validates
  that the URL resolves; a first submission or a resubmission against a
  down or stale URL fails at the form, not at review. The page is generated
  from this repo's own `packages/extension/PRIVACY_POLICY.md` by
  `xchain-websites/xchain.io/build/privacy.build.js`, and
  `xchain-websites/test/wallet-privacy-policy-sync.test.js` (run in the
  `xchain-websites` repo's `npm test`) fails if the hosted page has drifted
  from this file, the same mismatch-rejection risk spec §3.3 names one layer
  down. Whenever this file changes, in `xchain-websites`: run
  `node xchain.io/build/build.js`, confirm the sync test passes, commit the
  regenerated `xchain.io/wallet/privacy/index.html`, and deploy that repo,
  all BEFORE the store publish step below. The websites deploy is owned by
  the release operator, same as this checklist.
- ⬜ `pnpm test:smoke` passes, which includes the manifest-freeze rules
  (`permissions-frozen`, `host-permissions-frozen`,
  `content-script-matches-frozen`, `war-matches-match-content-script`).
  A failure here means `manifest.json`'s permissions, `host_permissions`,
  or content-script/`web_accessible_resources` match lists drifted from
  the pinned allowlist, or the three match lists drifted from each other.
- ⬜ **Human diff of `manifest.json`.** The freeze gate above lives in the
  same repo as `manifest.json`, so one commit can edit both together; it
  stops accidents, not a determined compromise. Before every submission,
  the release operator runs
  `git diff <previous-release-tag> HEAD -- packages/extension/manifest.json`
  and reads every line. Any change is a deliberate decision recorded
  against a spec §8 D-item, never a side effect nobody noticed. Permission
  changes silently trigger CWS re-review and can disable the extension for
  installed users until they re-accept.
- ⬜ **Pre-upload sha256 check.** The uploaded artifact is exclusively the
  CI-emitted `xchain-wallet-extension-vX.Y.Z.zip`; never a locally built
  zip (this repo's shared worktree has a documented incident class of
  builds carrying a neighbour's uncommitted edits). Before upload, run:
  `bash tools/release/verify.sh --input release-artifacts/vX.Y.Z/ --tag vX.Y.Z --artifact xchain-wallet-extension-vX.Y.Z.zip`
  and confirm it reports the hash, header anchor, and (once G180 lands)
  signature as OK. Record the checked sha256 in
  `packages/extension/docs/publish-log.md`'s row for this upload, in the
  same step as the upload.
- ⬜ **Post-publish verify (first publish, and after any account-security
  event; recommended every publish once routine).**
  `bash tools/release/verify-store.sh` against the store-installed build
  passes. A never-green run of this script means the script is broken and
  must be fixed, never waived (see the script's own header).
- ⬜ **Store-version monitor is LIVE before the public flip ( §2,
  §4 exit criteria).** `tools/release/store-version-monitor.mjs` reads
  `packages/extension/docs/publish-log.md` and compares it against the
  version the Chrome Web Store is actually serving for each configured
  item (main, and beta once that item exists); a live version with no
  matching log row is the rogue-publish incident signal - a build went
  out through the console without the logged, one-operator process,
  which is what a compromised or phished publisher account produces.
  §4 lists this monitor as one of the four rollout exit criteria
  alongside the two-machine store install and the 24h auto-update
  observation, so it gates the flip from unlisted to public the same as
  the other three, not just "built" the way this row can otherwise be
  checked off too early. Do NOT compare against the latest release tag
  instead of the log: the store lawfully lags the tag during review and
  after a rejection, and a tag-based check false-alarms on every normal
  release. As of this writing the script exists (tested, driven by hand
  against fixtures) but is installed nowhere; this row stays ⬜ until an
  operator confirms the origin-host cron is actually running, per
  `tools/release/README.md`'s `store-version-monitor.mjs` row and the
  script's own `--help` output for the install line and exit codes.

---

## Documentation parity check

Before sign-off, verify the docs that ship with this release still match
what the code actually does (Cluster T FOLLOWUP 5). A doc that lies is
worse than one that's silent.

- ⬜ `docs/ARCHITECTURE.md` - the four-layer signal flow, signer
  abstraction, storage substrate, and reachability sections still match
  the current code. Look for renamed packages, deleted flows, or new
  bridge surfaces.
- ⬜ `docs/BRIDGE.md` - every method listed (connect, getAccounts,
  getSupportedChains, getActiveChains, signMessage, signAction,
  signPsbt, signIn, disconnect, parallel, on/off) is registered in
  `packages/extension/src/bridge/handlers.js`. Error code table covers
  every code the handlers throw (BLOCKED_BY_USER, THROTTLED, etc.).
- ⬜ `docs/Reproducible_Builds.md` - per-target status table reflects
  the current build pipeline. Desktop `reproduce.sh` references the
  hash file the script actually produces.
- ⬜ `docs/Verify_Release.md` - GPG key fingerprint placeholder is up
  to date with the actual published key (or still flagged honestly as
  "pending publication").
- ⬜ `docs/GLOSSARY.md` - newly-added user-facing terms from this
  release are present (e.g. when a feature ships a new on-screen word
  the user might not know). Cross-link to `xchain-documentation/Key_Terms.md`
  is current.
- ⬜ `docs/Threat_Model.md` - controls table and out-of-scope section
  still hold. Anything new in the threat surface (a new bridge method,
  a new signer kind, a new persistent surface) gets a row.
- ⬜ `MAINTAINERS.md` - lead maintainer + escalation contacts are
  current. If a maintainer added or removed since the last release,
  this row blocks until the file is updated.
- ⬜ `SECURITY.md` - disclosure contact is still active; supported
  versions row reflects the current release window.
- ⬜ `CONTRIBUTING.md` - Last reviewed footer bumped if any contributor-
  facing process changed (test tiers, smoke baseline rule, version-bump
  rule, governance section).
- ⬜ `CODE_OF_CONDUCT.md` - reporting contact is still active.

---

## Sign-off

Release manager: ___________________________  
Date: ___________________________  
Version under test: ___________________________  
Shell(s) covered: ___________________________  
Notes / known waivers: ___________________________  

---

Last reviewed: 2026-04-29 at v0.310.0.
