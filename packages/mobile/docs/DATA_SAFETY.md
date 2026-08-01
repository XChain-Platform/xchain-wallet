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

| Endpoint | Why | What leaves the device |
|---|---|---|
| `https://explorer.xchain.io` | balances, history, token data | the addresses being queried, and the requesting IP |
| `https://encoder.xchain.io/` | builds unsigned transactions | transaction inputs: addresses, amounts, ticks |
| `https://hub.xchain.io/` | signed chain-registry snapshot, fee data | nothing identifying beyond the request itself |
| `https://api.coingecko.com/api/v3` | fiat price display | the requesting IP; no addresses, no amounts |
| `https://downloads.xchain.io/wallet/android/latest.json` | the direct-install update notice (§6) | the requesting IP, once a day at most, user-disableable |

All five are user-configurable or user-disableable, and every one of them is
first-party except CoinGecko.

**The honest part, which the marketing copy must not contradict:** balance and
history queries send **wallet addresses** and the device's **IP address** to
first-party infrastructure. Whether that counts as "collection" under Google's
definitions turns on ephemerality and on server-side logging, which is our
decision to make and then to stand behind. The position below is the one to
hold only while it is true:

> Requests are served without an account, without a cookie, and without a
> device identifier. Addresses are query parameters, not stored records tied
> to a user. If any of that changes on the server side, this form changes with
> it in the same week.

Nobody should fill this form again without re-running the audit above; the
day a new endpoint is added, this table is where it has to appear first.

---

## Form answers

### Data collection and sharing

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **No** |
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
