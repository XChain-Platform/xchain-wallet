# Play Data safety answers (Android)

**Item:**  §5. **Status:** drafted 2026-07-31 (stage S4), not submitted.

The form, the privacy policy and the observable traffic have to agree. A
mismatch is a rejection class, and for a wallet that markets itself on privacy
it is also the kind of thing that gets written about. So these answers are
derived from **an audit of what the app actually calls**, not from what we
intend it to do.

---

## The wire audit (do this again before every submission)

Endpoints the shipped app can contact, found by reading the defaults in
`packages/core/src/registry/descriptors/`, `packages/core/src/flows/`, and the
update client:

**CORRECTED 2026-08-01 ().** This table was drafted by hand and was
wrong in two directions. Re-deriving it for the iOS twin found a whole class of
third-party contact missing, and one endpoint listed that nothing calls. The
list is no longer maintained here: **the source of truth is
`packages/core/src/privacy/wireAudit.js`**, and
`test/unit/mobile/wireAudit.test.js` fails when a flow module names a host that
file has not classified. Read the module; do not re-derive this by hand again.

| Endpoint | Why | What leaves the device |
|---|---|---|
| `https://explorer.xchain.io` | balances, history, token data | the addresses being queried, and the requesting IP |
| `https://encoder.xchain.io/` | builds unsigned transactions | transaction inputs: addresses, amounts, ticks |
| `https://hub.xchain.io/` | signed chain-registry snapshot, fee data | nothing identifying beyond the request itself |
| `https://api.coingecko.com/api/v3` | fiat price display | the requesting IP; no addresses, no amounts |
| **a host the TOKEN ISSUER chose**, plus `ipfs.io` / `arweave.net` | the information document a token links from its own on-chain description | the requesting IP, and which token was opened, to a third party we do not choose and neither does the user |
| `https://downloads.xchain.io/wallet/android/latest.json` | "is there a newer version?", **for a directly-downloaded APK only** - never from a Play install | the requesting IP and the running version; no addresses, no identifiers |

**The row that was missing is the one that matters most on this form.** When
`privacy.metadataFetchEnabled` is true, which is the DEFAULT,
`flows/tokenInfo.js` follows a URL out of a token's on-chain description and
resolves `ipfs://` and `ar:` through public gateways. The published privacy
policy already discloses this; this form did not. It is a third-party contact,
on by default, to a destination chosen by whoever issued the token.

**Back, and lane-scoped: `https://downloads.xchain.io/wallet/android/latest.json`
(RE-ADDED 2026-08-02, D4 wired).** This row was removed on 2026-08-01
because the update-feed module existed, was tested, and **nothing imported it**,
so the request never happened; declaring traffic that does not occur is the same
class of error as omitting traffic that does. It now has exactly one caller, so
the row is back - but what it says matters more than that it is here:

> **A Play-installed copy never makes this request, on any setting.** The check
> is gated at runtime on the installer package (`XChainVault.getInstallOrigin`),
> not on a build flag, because §6 derives the universal APK from the same bundle
> as the store AAB - one build, two signatures - so nothing at build time can
> tell the lanes apart. Play-installed answers `store` and no provider is
> installed. Only a sideloaded APK, which no store keeps current, ever asks.

It is declared here anyway. Over-disclosing a request the Play build does not
make is the safe direction on this form; omitting one it might make is not. For
the sake of the answers below: the request carries the requesting IP and the
running version, no addresses and no identifiers, at most once a day, and the
user can switch it off in Settings › About › "Check for new versions".

Remote token MEDIA is deliberately absent: `img-src` admits no remote origin in
either build profile and there is no `media-src` at all, so images, audio and
video fall back to `default-src 'self'` and never load. Only the metadata JSON
egresses, because that is a `fetch` rather than a tag.

**The honest part, which the marketing copy must not contradict:** balance and
history queries send **wallet addresses** and the device's **IP address** to
first-party infrastructure. Whether that counts as "collection" under Google's
definitions turns on ephemerality and on server-side logging.

**That question is now answered, and the answer is not the one below.**
Measured on the live hosts 2026-08-01: the three first-party hosts write Apache
combined access logs carrying the client IP and the full request line, and a
balance query puts the wallet address in that request line; kept 14 days.
Google's definition of collection, like Apple's, turns on retention beyond
servicing the request. **Do not submit this form until D9 / is
answered**, because the iOS twin (`PRIVACY_NUTRITION_LABELS.md`) reaches
"collected" on the same facts and two stores cannot be told two different
things about one binary.

The position this file used to hold, kept for the record and NOT currently
supportable:

> Requests are served without an account, without a cookie, and without a
> device identifier. Addresses are query parameters, not stored records tied
> to a user. If any of that changes on the server side, this form changes with
> it in the same week.

The cheapest way to make that true again is to stop retaining the client IP on
those three hosts, which is option 1 in D9.

---

## Form answers

### Data collection and sharing

**: SETTLED (operator, 2026-08-02). These answers stand as drafted, and "No" is now a plain fact rather than a position.**

The 2026-08-01 concern was that our first-party hosts retained client IPs beside
address-bearing request lines for 14 days, which is the fact Google's and
Apple's definitions of collection both turn on. Measurement dissolved it. The
hosts are Cloudflare-proxied and origin-host loads no `mod_remoteip`, so Apache's
`%h` records a Cloudflare edge address, not a visitor's: 844 of 846 distinct
sources on explorer, 119 of 120 on encoder, 162 of 162 on hub. **No wallet user
IP is retained.** Only explorer carried addresses in request lines, and that log
now has 1-day retention. Full detail and the two commands that re-measure it are
in `docs/Data_Collection.md` Q1.

The iOS twin now reaches "Data Not Collected" on these same facts, so the two
forms agree, and `test/smoke/audits/extension-data-disclosure.smoke.js` fails if
they ever stop agreeing with each other or with the Chrome form.

The position this file used to hold, kept for the record:

> Requests are served without an account, without a cookie, and without a
> device identifier. Addresses are query parameters, not stored records tied
> to a user. If any of that changes on the server side, this form changes with
> it in the same week.

That paragraph is now true for a stronger reason than it claimed.

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **No** (: SETTLED 2026-08-02) |
| Is all of the user data collected by your app encrypted in transit? | **Yes** (TLS only; `usesCleartextTraffic=false` plus a network security config that refuses cleartext) |
| Do you provide a way for users to request that their data is deleted? | **Not applicable** (no account, no server-side user data; uninstalling removes everything, and the app can wipe its own storage from Settings) |

### Per-category answers

| Category | Collected | Shared | Notes |
|---|---|---|---|
| Location | No | No | No location permission is declared. |
| Personal info | No | No | No name, email, address, or user ID. There is no account. |
| Financial info | No | No | Balances are read from a public blockchain; nothing is stored by us. Keys never leave the device. |
| Health and fitness | No | No | |
| Messages | No | No | Encrypted on-chain messaging is user-to-user; we hold no copy. |
| Photos and videos | No | No | Camera is used for live QR decoding only. No image is stored, saved, or transmitted. |
| Audio | No | No | |
| Files and docs | No | No | |
| Calendar | No | No | |
| Contacts | No | No | The in-app address book is local, and no device contacts permission is declared. |
| App activity | No | No | No analytics SDK is present in any shell. |
| Web browsing | No | No | |
| App info and performance | No | No | No crash-reporting SDK; there is no Crashlytics, no Sentry. |
| Device or other IDs | No | No | No advertising ID, no device ID is read or sent. |

### Security practices

- Data is encrypted in transit (TLS enforced at the platform level).
- Users can request data deletion: not applicable, but the app can erase its
  own storage from within Settings, and uninstalling removes it all.
- The app follows the Play Families policy: not applicable, not targeted at
  children.
- Independent security review: **not yet.** Do not claim one until there is a
  report to point at.

---

## Cross-checks before submitting

⬜ Every endpoint in the table above appears in the privacy policy's mobile
   section, and the policy claims nothing the table contradicts
⬜ The manifest still declares exactly: INTERNET, CAMERA, USE_BIOMETRIC,
   USE_FINGERPRINT (maxSdkVersion 27), and nothing else
⬜ No analytics or crash-reporting dependency has entered any shell
   (`pnpm why` on any suspicious transitive addition)
⬜ The update-check endpoint is still the static JSON file, still
   user-disableable, and still sends nothing but the request
