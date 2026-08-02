<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright © 2026 Dankest, LLC -->

# Chrome Web Store data disclosure (Privacy practices tab)

**Item:**  §3.3, stage S15. **Status:** DRAFT. **No answer is blocked any more** (: SETTLED, see §4). Nothing here has been submitted.  
**Audience:** the release operator sitting at the CWS developer console,
working `SUBMISSION-RUNBOOK.md` Phase 5.  
**Gated by:** `test/smoke/audits/extension-data-disclosure.smoke.js`.

This is the third store form, and it asks the same questions as the other
two in a third vocabulary. The answers are a **translation of
`docs/Data_Collection.md`**, the declaration of record, exactly as
`packages/mobile/docs/DATA_SAFETY.md` (Play) and
`packages/mobile/docs/PRIVACY_NUTRITION_LABELS.md` (Apple) are. Do not
answer this form from the privacy policy prose, and do not answer it from
memory of what the other two say: change `Data_Collection.md` first, then
all three.

Until 2026-08-02 this document did not exist, and `SUBMISSION-RUNBOOK.md`
Phase 5 told the operator to "tick the boxes to match `docs/Privacy_Policy.md`
exactly". That policy covers five shells and enumerates no boxes, so the most
rejection-prone form in the ceremony was the one field with no paste-ready
source. Spec §3.3 has named a data-disclosure/policy mismatch as a rejection
cause since the spec was written.

---

## What the console is the authority on

Two different things are quoted below and they are not equally certain:

- **The Chrome Web Store User Data Policy vocabulary is confirmed
  verbatim** from the published policy (personally identifiable
  information, financial and payment information, health information,
  authentication information, website content and resources, form data,
  web browsing activity, personal communications, user-generated content),
  with its definitions. That vocabulary is what the reasoning below rests
  on, and it is stable.
- **The console's on-screen checkbox labels are not quoted from the
  console**, because this repo cannot see it. They are grouped below under
  the labels the dashboard is expected to show.

So: answer by the FACT, then find the checkbox whose label covers that
fact. If the console shows a category this document does not name, or
names one differently, **tick by the fact and record what you actually saw
here**, in the same pass, before you submit. That is the same rule §5 of
`STORE_LISTING_PACK.md` carries for the category taxonomy, for the same
reason: a document that guesses at a menu it cannot see should say so
rather than be believed.

---

## 1. Fields that are not data questions

These are answered elsewhere and are listed only so this document maps the
whole tab and the operator is not left wondering which file a field comes
from.

| Console field | Answer comes from |
|---|---|
| Single purpose | `STORE_LISTING_PACK.md` §1 |
| Permission justification, one per permission | `STORE_LISTING_PACK.md` §2 |
| Content-script / host-permission justification | `STORE_LISTING_PACK.md` §3 |
| Privacy policy URL | `https://xchain.io/wallet/privacy/` (trailing slash; verified live by `tools/release/verify-privacy-url.mjs`) |

## 2. Remote code

**Answer: No, the extension does not execute remote code.**

Paste-ready justification:

> All executable code ships inside the extension package. The extension
> loads no script from any remote origin, uses no `eval` or
> `new Function` on fetched content, and its only network traffic is data
> (JSON from blockchain APIs and a price feed), never code. The build is
> reproducible from source, so the published package can be rebuilt and
> compared byte for byte.

This is not a claim on trust: `packages/extension/scripts/remote-code-audit.mjs`
audits the built bundle for remote-code patterns and gates on them
(stage S2,  §3.2). It allow-lists three known-benign hits by code
signature and was mutation-tested in both directions. Re-run it before
each submission.

Related, and asked separately by the form's Limited Use text: the
extension **does not use Google APIs and does not process Google user
data**. `docs/Privacy_Policy.md` carries the required Limited Use
statement verbatim.

## 3. What the extension sends off the device

Derived from `packages/core/src/privacy/wireAudit.js`, filtered to the
`extension` shell. This is the table the data-usage answers are reasoned
from, and the smoke fails if a host egresses on this shell and is missing
here, or if a host is listed here that the extension does not contact.

| Host | Party | Why | What leaves | User control |
|---|---|---|---|---|
| `explorer.xchain.io` | first | balances, transaction history, token rows, fee quotes | the addresses being queried, and the requesting IP | Settings › Networks (endpoint is user-configurable) |
| `encoder.xchain.io` | first | builds the unsigned transaction the device then signs | addresses, amounts, ticks, and the requesting IP | Settings › Networks (endpoint is user-configurable) |
| `hub.xchain.io` | first | signed chain-registry snapshot, fee data, SPV checkpoints | the requesting IP; no addresses | Settings › Networks (endpoint is user-configurable) |
| `api.coingecko.com` | third | native-coin price and market statistics | the requesting IP, and that a wallet is in use; no addresses | Settings › Privacy › coin statistics (ON by default) |
| `ipfs.io` | third | gateway for a token linking to `ipfs://` | the requesting IP, and which token was opened | Settings › Privacy › token information (ON by default) |
| `arweave.net` | third | gateway for a token linking to `ar:` | the requesting IP, and which token was opened | Settings › Privacy › token information (ON by default) |
| **a host the token issuer chose** (`*`) | third | the token information document linked from a token's own on-chain description | the requesting IP, and which token was opened, to a host neither we nor the user picked | Settings › Privacy › token information (ON by default) |
| `mempool.space` | third | the block-explorer icon beside a "view on explorer" link | the requesting IP, and that a transaction detail view was opened | **none** |
| `blockstream.info` | third | the block-explorer icon beside a "view on explorer" link | the requesting IP, and that a transaction detail view was opened | **none** |
| `litecoinspace.org` | third | the block-explorer icon beside a "view on explorer" link | the requesting IP, and that a transaction detail view was opened | **none** |
| `blockchair.com` | third | the block-explorer icon beside a "view on explorer" link | the requesting IP, and that a transaction detail view was opened | **none** |
| `www.blockcypher.com` | third | the block-explorer icon beside a "view on explorer" link | the requesting IP, and that a transaction detail view was opened | **none** |
| **a host the user typed** (`*`) | third | restoring an encrypted backup from a link the user supplies | the requesting IP; the file is already encrypted under the user's password | user-initiated only, `https` only |

Two rows deserve a second look before any of this is transcribed, and
they are the two `Data_Collection.md` already flags:

- **The token-issuer host.** The only automatic contact to a destination
  that neither we nor the user chose, on by default. A token issuer can
  learn who opened their token.
- **The five explorer icons.** The only egress on this shell with **no
  user control at all**, fired as a routine screen renders, before the
  user clicks anything. They happen on the extension and nowhere else:
  the extension ships no `content_security_policy` key, so MV3's default
  applies and does not restrict `img-src`, while every other shell injects
  a CSP whose `img-src` admits no remote origin.

`downloads.xchain.io` is deliberately absent: the update feed is a desktop
path, and the extension updates through the browser's own store. Declaring
traffic that does not occur is the same class of error as omitting traffic
that does.

Ledger hardware wallets use WebHID over USB and make no network request at
all. Trezor is not supported in this shell, so `connect.trezor.io` is never
contacted here.

## 4. The collection decision

**: SETTLED (operator, 2026-08-02). The answer is that the wallet
does not collect user data, and it is a plain fact rather than an
argument.** The same answer lands on all three store forms.

It was blocked here for a day on a premise that measurement dissolved. The
2026-08-01 record said `explorer`, `encoder` and `hub` each logged the
client IP alongside a request line carrying the wallet address, retained 14
days. That was read off the Apache format string (`combined` starts with
`%h`) rather than off the logs. `%h` is whoever opened the TCP connection,
and behind a reverse proxy that is the proxy.

Measured on the live host 2026-08-02:

- All three hosts are Cloudflare-proxied, and origin-host loads no
  `mod_remoteip` and configures no `CF-Connecting-IP` handling.
- So the logged source is a Cloudflare edge address, not a visitor's:
  explorer **844 of 846** distinct sources inside Cloudflare's published
  ranges, encoder **119 of 120**, hub **162 of 162**.
- **No wallet user IP is retained, so there is no IP-to-address linkage to
  disclose.**
- Only `explorer` carried wallet addresses in its request lines (857 of
  7,520 that day). `encoder` takes them in POST bodies, which `combined`
  does not log; `hub` carries none.
- That one log now has **1-day retention**
  (`/etc/logrotate.d/xchain-explorer`, `daily`, `rotate 1`), so no wallet
  address survives 24 hours. Every other vhost is untouched at 14 days.

Cloudflare still sees and logs the visitor IP at its edge under its own
policy. That is disclosed as a third-party contact, and it is not our
retention.

**What would make this false again**, and both are things a sensible admin
might do for good reasons: enabling `mod_remoteip` (which would start
recording real client IPs), or moving the explorer log back under
`/var/log/apache2/*.log` (which would silently restore 14-day retention).
`docs/Data_Collection.md` carries the two commands that re-measure both;
run them before every submission.

## 5. Data usage: the answers that are not blocked

Every "No" below carries the reason it is a No, in a form a reviewer can
check against the code, because an unstated "no" reads as an oversight.

| Category | Collected | Why |
|---|---|---|
| Health information | **No** | Nothing in the product touches health data of any kind. |
| Authentication information | **No** | The recovery phrase, private keys, wallet password and vault contents are encrypted at rest (AES-256-GCM under an Argon2id-derived key) in `chrome.storage.local` and **no code path transmits any of them anywhere**. See "the judgment calls" below, because this one has a counter-argument worth knowing. |
| Personal communications | **No** | XChain messaging is end-to-end encrypted between two users and written on-chain; we operate no message store and hold no copy, and no plaintext ever reaches a server. The ciphertext does transit `encoder.xchain.io` on its way into a transaction, which is the same first-party-log fact as §4. |
| Location | **No** | No geolocation API is called and no location permission is declared. The requesting IP that every HTTPS request necessarily carries is covered by §4, not here. |
| Web browsing activity / web history | **No** | This is the strongest No on the form and the one a reviewer will probe hardest, so it is stated structurally: `host_permissions` is **empty**; no `tabs`, `webNavigation`, `history` or `webRequest` permission is declared; the content script is a `postMessage` relay that reads no page content and makes no cross-origin request. The list of dApp origins the user has approved is stored in `chrome.storage.local` and is never transmitted. |
| User activity | **No** | No analytics SDK, no crash reporter, no usage tracking, in any shell. No clicks, keystrokes, scroll or mouse position are recorded. Verified across the whole workspace and dependency tree, and `test/smoke/audits/store-collateral.smoke.js` keeps that claim honest. |
| Website content and resources | **No** | The content script injects `window.xchain` and relays only the requests a page's own script explicitly makes to that provider. It does not read, scrape or transmit page text, images, media or links. |
| Form data | **No** | Nothing reads or transmits the contents of any page's form fields. |
| User-generated content | **No** | Labels, contacts and memos the user types stay in the local encrypted vault. A memo the user chooses to put in a transaction goes on-chain by their own action; that is the transaction, not collection. |
| Personally identifiable information | **No** | No name, email, phone, username or account exists anywhere in the product. The one arguable edge was a wallet address retained beside a client IP, since the policy's definition of PII reaches "any type of identification number, such as ... account number". No client IP is retained (§4), so nothing links an address to a person. |
| Financial and payment information | **No** | Balances and transaction inputs are transmitted to first-party servers to read the chain and build an unsigned transaction, which is the request itself rather than collection. Nothing is retained beyond servicing it: `encoder` logs no addresses at all, and `explorer`'s request lines are kept 1 day and carry no client IP (§4). |

### The judgment calls, written down so they are not re-argued at the console

**Authentication information, and why a wallet full of keys answers "No".**
Chrome's User Data Policy defines *handling* as "collecting, transmitting,
using, or sharing user data", and the disclosure asks what the extension
collects. The seed, keys and password are generated on the device, are
encrypted at rest, and leave it never; there is no server to send them to,
because there is no server. That is the same answer every comparable
self-custodial wallet gives, and it is consistent with the policy the
listing points at. The counter-argument, stated so nobody discovers it
mid-review: the extension undeniably *stores* authentication material, so
if the console's on-screen label reads "collect **or store**" rather than
"collect", tick it and describe it as local-only, encrypted, never
transmitted. Answer what the label in front of you actually says.

**The "ADS" setting is not advertising.** It stands for Automatic Donation
System: an optional setting that adds a small extra output to the user's own
transaction, paying a project donation address. It sends no data, makes no
extra network call, and is not an ad product. It is also inert today (the
donation addresses still ship as a placeholder sentinel). Do not let the
acronym pull this listing into an advertising category on any form.

## 6. Certifications

All three are certified. They are true statements about this product, not
aspirations:

✅ **I do not sell or transfer user data to third parties**, outside of the
approved use cases. There is nothing to sell: no account, no profile, no
user record. The third-party contacts in §3 are the user's own content
requests (a price, a token's metadata document, an explorer's icon), not
transfers of user data to those parties.  
✅ **I do not use or transfer user data for purposes unrelated to the
item's single purpose.** The single purpose is in `STORE_LISTING_PACK.md`
§1, and every permission in the manifest is justified against it there.  
✅ **I do not use or transfer user data to determine creditworthiness or
for lending purposes.** The product has no credit, lending or scoring
feature of any kind.

## 7. Before you tick anything

✅ : SETTLED 2026-08-02. This document, `DATA_SAFETY.md` and
`PRIVACY_NUTRITION_LABELS.md` all answer "not collected", and a smoke fails if
they ever stop agreeing. Three stores, one binary.  
⬜ `docs/Data_Collection.md` has been re-read and is still true; in
particular its server-logging finding is a claim with an expiry date and
§4 rests on it. Re-measure the access-log config and retention on
`explorer`, `encoder` and `hub` before submitting.  
⬜ `node packages/extension/scripts/remote-code-audit.mjs` is clean, so §2
is a measurement rather than a memory.  
⬜ `node tools/release/verify-privacy-url.mjs` exits 0, so the policy URL
the form validates is live and serving the current policy. **Run it for
real, over the network.** `pnpm test:smoke` exercises the checker against
stubs, not against the live URL, which is exactly how a 404 survived every
green suite on 2026-08-01. Known and harmless as of 2026-08-02: Cloudflare
obfuscates the policy's contact address at the edge, the checker decodes
that, and the open question of whether a legal document's contact should be
JavaScript-gated is tracked in `STORE_LISTING_PACK.md` §5.  
⬜ `pnpm test:smoke` is green, so §3's host table still matches
`wireAudit.js` and §5's permission claims still match `manifest.json`.  
⬜ Any console label that differs from the categories named here has been
recorded in §"What the console is the authority on" above, in this pass,
before submission.

## 8. Change log

- 2026-08-02: created, stage S15 . The Chrome data-disclosure
  answers did not exist; Phase 5 of the runbook pointed the operator at a
  five-shell prose policy and told them to tick boxes it does not
  enumerate. Building it surfaced that ** blocks this form too**,
  which neither that item nor  recorded:  named only the two
  mobile forms, and 's status line said nothing blocked first
  submission. Also corrected in the same stage: the five block-explorer
  rows in `wireAudit.js` still carried "nothing on this shell" and "the CSP
  img-src admits no remote origin" from when they were marked as egressing
  nowhere, which was the exact opposite of the truth for the one shell they
  claim, and `docs/Data_Collection.md` still described the pre-D6
  content-script scope.
