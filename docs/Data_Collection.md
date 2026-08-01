# Data collection: the declaration of record

**Status: DRAFT.** Three facts still need an operator answer before this
can back a store submission; they are listed at the bottom under
"Unsettled".

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
| 8 | Update check | `downloads.xchain.io` | Desktop on launch; Android at most once a day, and ONLY for a directly-downloaded APK (a Play install updates through Play and never makes this request) | Your IP and current version. Auto-download is off; installing is a click | No opt-out for the check itself |
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
- A content script matches all `http`/`https` pages to inject the dApp
  provider (`window.xchain`). It is a `postMessage` relay only; it reads
  no page content and makes no cross-origin request. All connection and
  approval policy is enforced in the background worker.

## Unsettled: needs an operator answer

These cannot be read out of the code, and the privacy policy cannot be
published without them. **One of the three (server logging) was settled on
2026-08-01 by measuring the live hosts; two remain, and both are decisions
rather than facts.**

1. ~~**Do our own servers log and retain client IPs?**~~
   **SETTLED 2026-08-01 by measurement on the live hosts**, not by asking:

   - Every one of `explorer.xchain.io`, `encoder.xchain.io`,
     `hub.xchain.io` and `downloads.xchain.io` has a
     `CustomLog ... combined` directive in its Apache vhost on
     origin-host. The "combined" format is
     `%h %l %u %t "%r" %>s %O "%{Referer}i" "%{User-Agent}i"`, so **yes,
     the client IP is logged**, along with the request line, referer and
     user-agent.
   - Retention is `/etc/logrotate.d/apache2`: **daily rotation,
     `rotate 14`**, so roughly **14 days** and then deletion.
   - Nothing correlates queries by IP: there is no account, no cookie and
     no identifier in the request to correlate them with.
   - Cloudflare does front the `xchain.io` hosts (confirmed: they answer
     with `server: cloudflare`), so its own logs are a second copy under
     its own policy. The company site `dankest.llc` is served directly
     from Apache and is NOT behind Cloudflare (confirmed:
     `Server: Apache/2.4.52`).

   **This is a claim with an expiry date.** It describes a configuration,
   and configurations change. Re-measure before each store submission,
   and change this file before the policy.
2. **Who is the data controller of record, and what is the contact
   address for privacy requests?** Dankest, LLC is the publisher;
   confirm the entity name and whether privacy mail goes to
   `legal@dankest.llc` or a dedicated address.
3. **Is any jurisdiction-specific section required** (GDPR lawful basis,
   CCPA notice)? This depends on where the entity operates and where the
   apps are listed, not on the code.

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
