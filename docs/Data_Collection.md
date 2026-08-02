# Data collection: the declaration of record

**Status: DRAFT.** 1 question still needs an operator answer before this
can back a store submission; it is listed at the bottom under
"Unsettled", with a stable `Q<n>` id. This count is checked against that
list by `test/smoke/audits/store-collateral.smoke.js`; it read "Three
facts" for a day after the second was settled.

**Item:**  §6c. **Audience:** whoever fills in a store form or
edits the privacy policy.

This is the single description of what XChain Wallet does and does not
collect. Every store form transcribes it. Google Play's Data Safety
form, Apple's App Privacy labels and the Chrome Web Store's data-use
disclosures ask overlapping questions in three different vocabularies,
and the way you get three consistent answers is to answer once, here,
and translate. The three forms must never be filled in independently.

The same applies to `docs/Privacy_Policy.md`: it is the plain-language
rendering of this file. If a fact changes, change it here first.

Everything below was read out of the code on 2026-07-31 and cites where.

---

## The short version

The wallet collects nothing. There is no account, no sign-up, no
analytics, no crash reporting, and no server that holds user data.

That is not the whole story, and the difference is what the store forms
are actually asking about. A self-custodial wallet has to ask a server
about the blockchain, and asking reveals which addresses you care about
to whoever answers. That is not collection in the sign-up sense, but it
is data leaving the device, and it has to be disclosed.

---

## What never leaves the device

Verified: no code path sends any of this anywhere.

- The recovery phrase (BIP39 seed) and every private key derived from it.
- The wallet password.
- Imported WIF private keys.
- The decrypted contents of the vault (labels, address book, settings).

Key material is encrypted at rest with AES-256-GCM under a key derived
by Argon2id (`packages/core/src/crypto/aead.js`,
`packages/core/src/crypto/kdf.js`). The storage layer never sees
plaintext (`packages/core/src/storage/backend.js:29`). Storage location
per shell: IndexedDB (web), `chrome.storage.local` (extension), a
`0600` file under the OS app-data directory plus the OS keychain via
Electron `safeStorage` (desktop,
`packages/desktop/main/{storage.js,keychain.js}`).

## Analytics, telemetry and crash reporting

**None, in any shell.** No analytics SDK, no crash reporter, no usage
tracking, no `Electron crashReporter`. Verified by searching the whole
workspace and dependency tree for the usual suspects. Nothing in the
codebase reports how the wallet is used to anyone.

The diagnostic dump (`packages/core/src/flows/diagnosticDump.js`) is
generated on device, only when the user asks for it, and is never
transmitted. It redacts every address, balance, txid, contact and
secret, and hashes free-form fields such as custom endpoint URLs rather
than including them.

## What does leave the device

Ordered by how routine it is. "Reveals" means what the receiving server
can learn, including the IP address any HTTPS request necessarily
carries.

| # | What | Goes to | When | Reveals | User control |
|---|---|---|---|---|---|
| 1 | Address queries: balances, history, UTXOs | `explorer.xchain.io` (per chain) | Whenever the wallet shows a balance or history | The addresses you hold, your IP | Endpoint is user-configurable in Settings |
| 2 | Transaction construction | `encoder.xchain.io` | When you compose a send or any action | Source and destination addresses, amounts, fees | Endpoint is user-configurable |
| 3 | Live address subscription (WebSocket) | explorer host | While notifications are on | The address being watched, a persistent connection from your IP | Follows the explorer setting |
| 4 | Config and chain-registry lookups | `hub.xchain.io` | On every app or service-worker start | Your IP only. No wallet data. The response is Ed25519-signed against a pinned key and fails closed | Not surfaced as a toggle |
| 5 | Coin price lookups | `api.coingecko.com`, a third party | Viewing a native-coin page, and a five-minute poll only while a price alert is armed | Your IP and which coins you looked at. No addresses | Opt-out: Settings, `privacy.priceDataEnabled`. Defaults on. The wallet's own hub-mirrored oracle is tried first |
| 6 | Token metadata fetch | **A URL taken from the token's own on-chain record, so a server chosen by whoever issued the token** | Viewing a token whose description is a URL | Your IP, and to that issuer, that you looked at their token | Opt-out: Settings, `privacy.metadataFetchEnabled`. Defaults on |
| 7 | Trezor Connect | `connect.trezor.io` (SatoshiLabs) | Only if you pair a Trezor. Web and desktop shells only. The extension ships no Trezor support (MV3 forbids the runtime-loaded vendor code it needs), and the mobile shells wrap the same web build but are compiled with a CSP that omits connect.trezor.io from script-src and frame-src, so the request cannot leave there either | Handled inside Trezor's own frame under their privacy policy. Public keys and addresses transit their transport | Only reached by choosing to use a Trezor |
| 8 | Update check | `downloads.xchain.io` | Desktop on launch; Android at most once a day, and ONLY for a directly-downloaded APK (a Play install updates through Play and never makes this request) | Your IP. On desktop the version is NOT sent (the wallet fetches the latest release's description and compares on-device), and the per-install identifier electron-updater would send is overridden with a fixed placeholder; captured in `docs/update-check-capture.json`. Auto-download is off; installing is a click | Android: opt-out in Settings › About › "Check for new versions". Desktop: no opt-out for the check itself |
| 9 | Backup restore from a pointer | A URL **you** type | Only when you restore from a pointer | Whatever that host logs. The payload is already encrypted with your password. `https:` is enforced | Entirely user-initiated |
| 10 | Block-explorer icon loads | `mempool.space`, `blockstream.info`, `litecoinspace.org`, `blockchair.com`, `blockcypher.com`, depending on the coin | Whenever a transaction detail view renders on mainnet or testnet, before you click anything | Your IP, and that you opened a transaction detail view | **None. There is no toggle for this one** |
| 11 | IPFS and Arweave gateway fetches | `ipfs.io`, `arweave.net` | When a token's metadata document (row 6) or a media URL inside it is an `ipfs://` or `ar://` link | Your IP and the content id you resolved | Follows row 6: `privacy.metadataFetchEnabled` |

Row 6 deserves a second look when filling in forms. It is the only case
where the wallet contacts a host that neither we nor the user chose, and
a token issuer can use it to learn who is looking at their token. It is
on by default, which is a defensible product choice but must be
disclosed rather than buried.

**Row 10 deserves the same second look, for the opposite reason.** It is
the only egress in this table with no user control at all: five
third-party hosts, contacted on a routine screen, before the user clicks
anything. It was missing from this table until 2026-08-01 while the
privacy policy disclosed it, which is the wrong way round, since this
document is what a store form gets transcribed from. `test/smoke/audits/
store-collateral.smoke.js` now derives the host list FROM the policy, so
a host disclosed there and absent here fails the build rather than
waiting to be noticed.

Ledger hardware wallets use WebHID over USB and make no network request
at all.

## What the wallet does NOT do

Stated explicitly because store forms ask, and because an unstated "no"
reads as an oversight:

- No advertising, no ad SDK, no ad identifiers, no ad network.
- No sale or sharing of data with data brokers. There is nothing to sell.
- No user accounts, email collection, phone numbers or contact upload.
- No location, camera, microphone or contacts access.
- No cross-app or cross-site tracking. The extension requests **no**
  host permissions at all (`host_permissions: []`).
- No child-directed content and no age gate. The product is a
  self-custody wallet for adults handling their own funds.

**The "ADS" feature is not advertising.** It stands for Automatic
Donation System (`packages/core/src/flows/ads.js`): an optional setting
that adds a small extra output to your own transactions paying a project
donation address. You are asked about it once during setup and can
change it in Settings at any time. It sends no data, makes no extra
network call, and is not an ad product. Whoever fills in a store form
must not let the acronym pull it into an advertising category. It is
also inert today: the donation addresses still ship as a placeholder
sentinel, so no donation output is added.

## Extension permissions, and why each exists

`packages/extension/manifest.json`:

- `storage`: the encrypted vault and small operational state.
- `sidePanel`: renders the wallet in Chrome's side panel.
- `notifications`: delivers the transaction and price alerts you enable.
- `alarms`: wakes the service worker so the notification connection does
  not silently die.
- `host_permissions`: **empty.**
- A content script matches `https://*/*`, `http://localhost/*` and
  `http://127.0.0.1/*` to inject the dApp provider (`window.xchain`). It
  is a `postMessage` relay only; it reads no page content and makes no
  cross-origin request. All connection and approval policy is enforced in
  the background worker.

  **Corrected 2026-08-02.** This line said "matches all `http`/`https`
  pages" for two days after the operator narrowed it ( D6,
  2026-07-31, which deleted the plain-HTTP injection surface). It is the
  scope a store form asks about, in the document store forms are
  transcribed from, so it is now derived rather than restated:
  `test/smoke/audits/extension-data-disclosure.smoke.js` compares this
  list against `packages/extension/manifest.json` and fails on drift.

The Chrome Web Store asks these questions in its own vocabulary, on the
console's Privacy practices tab. The translation of this document into
that form lives in `packages/extension/docs/DATA_DISCLOSURE.md`, beside
`packages/mobile/docs/DATA_SAFETY.md` (Play) and
`packages/mobile/docs/PRIVACY_NUTRITION_LABELS.md` (Apple). Three forms,
one set of facts, and the facts are here.

## Unsettled: needs an operator answer

These cannot be read out of the code, and the privacy policy cannot be
published without them. **Two of the three are now settled; one remains,
and it is a decision rather than a fact.**

Each question carries a stable id. `docs/Privacy_Policy.md`'s internal
status block cites the same ids, and
`test/smoke/audits/store-collateral.smoke.js` fails if the two files
disagree about which are still open. They numbered the same questions
differently until 2026-08-02, so the policy's "tracked in
docs/Data_Collection.md" pointer landed on the wrong row.

1. **[Q1 SETTLED 2026-08-01]** ~~**Do our own servers log and retain
   client IPs?**~~
   **Settled by measurement on the live hosts**, not by asking:

   **CORRECTED 2026-08-02 (). The 2026-08-01 answer was wrong,
   and it was wrong in the direction that made us look worse than we
   are.** It was derived by reading the Apache format string rather than
   by looking at what the logs actually contain. `combined` begins with
   `%h`, and `%h` is *whoever opened the TCP connection*, which behind a
   reverse proxy is the proxy. What follows was measured on the live
   host, by classifying the logged source addresses:

   - `explorer`, `encoder` and `hub` are all **Cloudflare-proxied**, and
     origin-host has **no `mod_remoteip` loaded and no `CF-Connecting-IP`
     handling configured anywhere in `/etc/apache2`**.
   - So `%h` records a Cloudflare edge address, not a visitor's. Measured
     2026-08-02 over a full day of traffic: explorer **844 of 846**
     distinct sources inside Cloudflare's published ranges, encoder
     **119 of 120**, hub **162 of 162**. The handful of others are
     direct-to-origin callers, not wallet traffic through the normal
     path.
   - **We therefore do not retain wallet users' IP addresses**, and there
     is no IP-to-address linkage anywhere in our logs to disclose.
   - What we *do* retain is the request line. On `explorer` that carries
     **wallet addresses** (857 of 7,520 request lines on the day this was
     measured). `encoder` carries **none**: it takes addresses in POST
     bodies, which `combined` does not log. `hub` carries none at all.
     So the exposure was one host, never three.
   - **Retention on that one host is now 1 day** (operator decision
     2026-08-02, ): `/etc/logrotate.d/xchain-explorer`, `daily`,
     `rotate 1`. The log lives at `/var/log/apache2/explorer/access.log`,
     in its own directory so it falls outside the `*.log` glob in
     `/etc/logrotate.d/apache2` that keeps every other vhost at 14 days.
     Full request paths survive for the window in which anyone actually
     debugs, and no wallet address survives past 24 hours.
   - Cloudflare still sees and logs the real visitor IP **at the edge**,
     under its own policy. That is a genuine third-party disclosure and
     it stays disclosed. The company site `dankest.llc` is served
     directly from Apache and is NOT behind Cloudflare.

   **This is a claim with an expiry date, and now you know which one.**
   Two configuration changes would silently make it false again, and
   both are things a sensible admin might do for good reasons:

   1. **Enabling `mod_remoteip`** (or any `CF-Connecting-IP` handling).
      That is the *correct* fix if you ever want real client IPs for
      analytics or fail2ban, and the moment it lands, `%h` becomes the
      visitor's address and every store form's "not collected" answer
      becomes false.
   2. **Moving the explorer log back** under `/var/log/apache2/*.log`,
      which silently restores 14-day retention of wallet addresses.

   Re-measure both before each store submission, and change this file
   before the policy:

   ```
   ssh origin-host.xchain.io "sudo apache2ctl -M | grep -i remoteip; \
     sudo grep -rhE 'RemoteIPHeader|CF-Connecting-IP' /etc/apache2/"
   ssh origin-host.xchain.io "sudo logrotate -d /etc/logrotate.conf 2>&1 \
     | grep -E 'rotating pattern: /var/log/apache2'"
   ```

   The first must print nothing. The second must show
   `/var/log/apache2/explorer/*.log ... (1 rotations)` alongside
   `/var/log/apache2/*.log ... (14 rotations)`.
2. **[Q2 SETTLED 2026-08-01 (operator, D1)]** ~~**Who is the data
   controller of record, and what is the contact address for privacy
   requests?**~~ The controller of record is **Dankest, LLC**, the
   publisher name registered on both stores. The privacy contact is
   **`privacy@dankest.llc`**, which was created that day and **proven to
   receive**: a message sent from origin-host was accepted by Google
   (`250 2.0.0 OK` via `aspmx.l.google.com`) and the operator confirmed
   it arrived. The address had been published in the policy since
   2026-04 without anyone checking it existed, which is the failure this
   closes.

   **The `legal@dankest.llc` candidate this question used to offer is
   retired, and it is worth saying why rather than deleting it.** That
   address appears in the licence header of nearly every file in the
   repo, so it is the plausible-looking wrong answer for anyone filling
   in a privacy-contact field from memory. It is the commercial-licensing
   contact. Privacy requests go to `privacy@dankest.llc` and nowhere
   else.

   This is one of five identity surfaces that have to agree and that
   reviewers cross-check, so it is never changed here alone; see
   `docs/Trader_Identity.md`, which is the declaration of record for the
   published set.

   **Recorded 2026-08-02:** this question stayed open in THIS file for a
   day after the policy's own status block recorded it as settled, which
   is backwards. This file is the source of record and the policy is its
   rendering; the rule at the top of this document ("if a fact changes,
   change it here first") was broken in the direction that matters least
   to notice and most to trust.
3. **[Q3 PENDING]** **Is any jurisdiction-specific section required**
   (GDPR lawful basis, CCPA notice)? This depends on where the entity
   operates and where the apps are listed, not on the code. No such
   section is published today, in this document or in the policy.

## Tor routing (desktop only)

The desktop app can send everything in the table above through a local
Tor SOCKS5 proxy. It is off by default. When it is on:

- Every path in the table is routed, not some of them: the blockchain
  queries, the transaction construction, the config lookups, the price
  and token-metadata fetches, and the update check.
- The proxy resolves the hostnames, so the user's DNS resolver does not
  see which servers the wallet contacts.
- If the proxy is not running, requests **fail**. They do not quietly go
  direct. This matters for a store answer: the wallet never silently
  downgrades a privacy setting.

**It is not offered on web or in the extension, and must not be claimed
for them.** A browser page cannot use a SOCKS proxy at all, and a
Chrome extension could only redirect the user's entire browser rather
than the wallet's own requests. The toggle is hidden on those shells
rather than shown and ignored.

This was ****: the toggle previously existed on all three shells
and did nothing anywhere. Implemented 2026-07-31.
