# App Store privacy nutrition labels (iOS)

**Item:**  §2.6 / §6. **Status:** drafted 2026-08-01 (stage S5a), not
submitted. The Play twin is `DATA_SAFETY.md` next to this file.

The label, the published privacy policy and the traffic a reviewer can capture
in Charles all have to say the same thing. A mismatch is a rejection before
approval and a removal after it, so these answers are derived from what the app
actually calls, never from what we meant it to call.

**The source of truth is code, not this file.**
`packages/core/src/privacy/wireAudit.js` lists every host the app contacts, on
which shell, and what leaves the device.
`test/unit/mobile/wireAudit.test.js` fails if a flow module names a host that
list has not classified, so the day someone adds a gateway constant, the build
tells them the store forms are now stale. Read the module before filling this
form; do not re-derive the list by hand.

---

## What the wire audit found, in the terms Apple asks about

On iOS, at default settings, the app automatically contacts:

| Host | Party | What leaves the device |
|---|---|---|
| `explorer.xchain.io` | first | the wallet addresses being queried, and the IP |
| `encoder.xchain.io` | first | addresses, amounts and ticks for the transaction being built, and the IP |
| `hub.xchain.io` | first | the IP only (signed config snapshot) |
| `api.coingecko.com` | third | the IP, and that a wallet is in use. Off in Settings › Privacy. Never called on test networks |
| a host **the token issuer chose**, plus `ipfs.io` / `arweave.net` | third | the IP, and which token was opened. Off in Settings › Privacy |

Three things that are on the Android list or in the privacy policy and are
deliberately **not** here, each for a structural reason rather than a promise:

- **Block-explorer icons** (`mempool.space`, `blockstream.info`,
  `litecoinspace.org`, `blockchair.com`, `www.blockcypher.com`). The policy says
  these load with no way to switch them off. That is true of the **extension**,
  whose MV3 default policy does not restrict images. Every other shell injects
  the §51 CSP, whose `img-src` admits no remote origin in either build profile,
  so the WebView never makes the request. Pinned by the structural tests in
  `wireAudit.test.js` and by `test/smoke/shells/mobile-ios-shell.smoke.js`.
- **Remote token media of every kind.** Same directive for images; audio and
  video have no `media-src` at all, so they fall back to `default-src 'self'`.
  Metadata JSON is still fetched (that is a `fetch`, not a tag), which is why
  the issuer-chosen host is on the list above and the media hosts are not.
- **The update feed** (`downloads.xchain.io`). An in-app "a newer version
  exists" notice is an App Store rules problem, not a preference. **The reason
  this stays true changed on 2026-08-02 and is worth reading, because the
  module is now wired on Android ( D4).** It is not wired by an import
  any more - both mobile shells serve the same web bundle, so the module ships
  here either way. It is wired by a NATIVE question: the shared code asks its
  plugin `getInstallOrigin()`, and only an explicit `direct` installs the
  update provider. **The iOS plugin implements no such method**, so this shell
  answers `unknown`, which is silent, and it cannot be made to answer anything
  else without adding Swift. `wireAudit.test.js` fails if that method ever
  appears in `XChainVaultPlugin.swift`.

## The one fact that decides the whole form

Apple's definition of "collect" is transmitting data off the device and keeping
it **longer than needed to service the request in real time**.

**CORRECTED 2026-08-02 (: SETTLED). The 2026-08-01 reading was wrong,
and measurement is what corrected it.** That reading said `explorer`, `encoder`
and `hub` each logged the client IP beside a request line carrying the wallet
address, retained 14 days, and concluded the app therefore collects. It was
derived from the Apache format string rather than from the logs: `combined`
begins with `%h`, and `%h` is whoever opened the TCP connection, which behind a
reverse proxy is the proxy.

All three hosts are Cloudflare-proxied and origin-host loads no `mod_remoteip`
and configures no `CF-Connecting-IP` handling, so `%h` records a Cloudflare edge
address. Classified over a full day of traffic on 2026-08-02: **844 of 846**
distinct sources on explorer are inside Cloudflare's published ranges, **119 of
120** on encoder, **162 of 162** on hub. **No wallet user IP is retained**, so
nothing links an address to a person.

Only `explorer` carried wallet addresses in its request lines (857 of 7,520 that
day); `encoder` takes them in POST bodies, which `combined` does not log, and
`hub` carries none. That one log now has **1-day retention** by operator
decision, so no address survives 24 hours.

On Apple's definition, which turns on retention beyond servicing the request,
the honest label is therefore **Data Not Collected**, and the Play file's
drafted "No" answers stand unchanged. The two forms agree, and the Chrome form
agrees with both.

Cloudflare still sees and logs the visitor IP at its edge under its own policy.
That is disclosed as a third-party contact; it is not our retention.


---

## Form answers

### Tracking

**Does this app track users? NO.** Nothing is linked to third-party data for
advertising or measurement, no data goes to a data broker, and there is no
analytics or attribution SDK in any shell. The App Tracking Transparency prompt
is therefore not required and must not be added.

### Data types

Filled in on the **not collected** posture the measurement above establishes.
Every row is "No", which is what "Data Not Collected" means on the App Store
submission form.

| Apple data type | Collected | Linked to the user | Used for tracking | Why |
|---|---|---|---|---|
| Other Financial Info | **No** | | | Balance and history queries carry wallet addresses and building a transaction carries addresses, amounts and ticks, but that is the request being serviced. Nothing is retained beyond it: encoder logs no addresses at all, and explorer's request lines are kept 1 day with no client IP beside them. |
| Other Data Types | **No** | | | We retain no client IP: `%h` records a Cloudflare edge address, not a visitor's (see above). Third parties do see the requesting IP for coin statistics (CoinGecko) and token information (an issuer-chosen host), both user-disableable in Settings › Privacy, and both disclosed in the privacy policy. |
| Contact Info | No | | | No name, email, phone or address is asked for or held. There is no account. |
| Health & Fitness | No | | | |
| Payment Info | No | | | Nothing is sold in the app. There is no IAP, no card, no fiat on-ramp. |
| Location | No | | | No location permission is declared. |
| Sensitive Info | No | | | |
| Contacts | No | | | The address book is local. No contacts permission is declared. |
| User Content | No | | | Encrypted on-chain messages are user to user; we hold no copy and no key. Photos are never read: the camera decodes QR frames live and stores nothing. |
| Browsing History | No | | | |
| Search History | No | | | |
| Identifiers | No | | | No user ID, no device ID, no advertising identifier is read or sent. |
| Purchases | No | | | |
| Usage Data | No | | | No product-interaction or advertising data is collected. |
| Diagnostics | No | | | No crash or performance SDK. No Crashlytics, no Sentry. |

### Export compliance (asked at the same time, kept here so it is answered once)

`ITSAppUsesNonExemptEncryption` is **NO** in the Info.plist, under the standard
exemption: the app uses TLS and standard, published cryptography (secp256k1
signing, AES-256-GCM at rest, argon2id, and standard ECDH for messaging) and
implements no proprietary algorithm. Two obligations ride with that answer:

- the **annual self-classification report to BIS** (recurring; owner per rails
  §4), and
- **France's separate declaration** if the app is ever released there, which
  interacts with the D7 territory list.

Record the ECDH messaging feature in the classification note explicitly, so the
answer is already justified the first time the form asks about it.

---

## The decision this file could not make, now settled

**D8 (operator + ops): do the API hosts keep retaining client IPs? SETTLED 2026-08-02. : SETTLED.**

Tracked in the ledger as ****, which is the canonical handle for it.
The Play file calls the same decision D9 and this one calls it D8, so until
2026-08-02 there was no shared token between the three store forms, and the
Chrome form (`packages/extension/docs/DATA_DISCLOSURE.md`) sat blocked on it
without anyone noticing:  named only the two mobile forms, and 
recorded that nothing blocked first submission.
`test/smoke/audits/extension-data-disclosure.smoke.js` now requires all three
forms to cite  or none of them to, so answering it edits three files in
one pass.

Three ways out, in the order that costs the user least:

1. **Stop retaining.** Drop the client IP from the access-log format on
   `explorer` / `encoder` / `hub`, or truncate it, and shorten retention. Then
   "Data Not Collected" becomes literally true on both stores, the Play file
   needs no change, and the privacy policy gets stronger rather than weaker.
   Cloudflare's own logging stays, and stays disclosed. This is the answer that
   makes the marketing claim and the form agree without a lawyer.
2. **Keep the logs, disclose them.** Submit the table above, and change
   `DATA_SAFETY.md` to match. Honest, and slightly worse in the listing.
3. **Keep the logs, answer "not collected", and argue the 14 days is
   operational.** Do not do this. It is the reading a regulator or a journalist
   would call wrong, and it puts the app one packet capture away from a
   removal.

**Answered 2026-08-02.** The premise turned out to be false: no visitor IP was
ever being retained, because `%h` behind Cloudflare records the edge, not the
caller. The only real residue was wallet addresses in explorer's request lines,
and the operator chose option 1 in substance: that log moved to
`/var/log/apache2/explorer/access.log` with its own logrotate stanza at
`rotate 1`, so nothing survives 24 hours, while every other vhost stays at 14
days. Applied and verified on origin-host the same day.

**Two changes would silently make this false again**, and both are things a
sensible admin might do for good reasons: enabling `mod_remoteip` (the correct
move if real client IPs are ever wanted for analytics or fail2ban), or moving
the explorer log back under `/var/log/apache2/*.log`. `docs/Data_Collection.md`
Q1 carries the two commands that re-measure both. Run them before every
submission.

## Cross-checks before submitting

⬜ `npx vitest run test/unit/mobile/wireAudit.test.js` is green, so the host
   list above still matches the code
⬜ D8 answered, and this file and `DATA_SAFETY.md` give the same answer
⬜ Every host here appears in `docs/PRIVACY_POLICY.md`, and the policy claims
   nothing this table contradicts
⬜ The privacy-policy URL in App Store Connect resolves (it 404'd once already;
   see `PLAY_ENROLLMENT.md`)
⬜ No analytics or crash-reporting dependency has entered any shell
⬜ A proxied run of the store build on a device shows no host outside the table
   (this is the check the reviewer can also perform)
