# Trader identity (EU DSA)

**Status: SETTLED 2026-08-01.** Every value below is decided. Nothing here
is a placeholder.

**Item:**  D1, adopted as shared collateral under  §6c.
**Audience:** whoever fills the trader declaration on any store submission.

Every major store forces a trader / non-trader declaration under the EU
Digital Services Act, and a trader declaration publishes the entity name,
postal address, email **and** phone number on the public listing,
permanently. Chrome, Play and the App Store each ask separately, and one
legal entity showing two different public trader contacts is what a
reviewer or a regulator notices.

This file is the single set of values, so the three cannot diverge. That
is not a hypothetical risk: on 2026-08-01 two Play documents still named
`support@xchain.io` for this declaration, months after `info@dankest.llc`
had replaced it, and both files sat directly underneath a paragraph
warning against exactly that inconsistency. It is held in place by
`test/smoke/audits/store-trader-identity.smoke.js`.

---

## The declaration

Transcribe these verbatim. Do not retype them from memory, and do not
"improve" one store's copy.

| Field | Value |
|---|---|
| Entity | `Dankest, LLC` |
| Street | `30 N Gould St Ste N` |
| City | `Sheridan` |
| State | `WY` |
| Postal code | `82801` |
| Country | `United States` |
| Email | `info@dankest.llc` |
| Phone | `+1 949-510-5364` |

As a block, in the form most console fields want:

```
Dankest, LLC
30 N Gould St Ste N
Sheridan, WY 82801
United States
info@dankest.llc
+1 949-510-5364
```

## Why each value is what it is

**Entity `Dankest, LLC`.** The legal entity, matching the Play publisher
and its D-U-N-S record. "XChain" is the product, carried by the item name,
not the publisher name.

**The postal address is a registered agent's.** That is the reason it can
be published permanently without the exposure a home address would carry:
it already exists to be public. The operator was asked which kind of
address it was before it was written down anywhere, because the answer
changes the advice and not merely the value. The postal code arrived
truncated and was confirmed rather than inferred; a guessed digit in a
permanent public legal declaration across three listings is the kind of
thing nobody catches later.

**The email is proven, not asserted.** `info@dankest.llc` is the address
the Play listing already publishes, which is where a reviewer cross-checks.
It was driven end to end from origin-host, accepted by Google
(`250 2.0.0 OK` via `aspmx.l.google.com`) and its arrival confirmed by the
operator. This project has published a contact address before without
anyone checking a mailbox existed behind it: `privacy@dankest.llc` sat on
the live policy page from 2026-04 until 2026-08-01 in exactly that state.

**The phone is the operator's personal mobile, published by explicit
decision.** The recommendation on record was a VOIP line forwarding to the
same handset, which satisfies the DSA identically, because the requirement
is a working means of contact and not a carrier line. The exposure was put
to the operator plainly before they chose: a number published permanently
against a named crypto company is a SIM-swap targeting signal, and the
carrier account behind it is the recovery path for mail, banking and
exchange accounts that hardware-key 2FA on the store accounts does not
cover. They weighed it and decided to publish it.

It is recorded as a deliberate choice so that a later reader does not
re-open it as an oversight and quietly substitute a different number at a
console. **If it is ever replaced with a forwarding line, the swap lands on
every store listing in the same pass**, or we create the one-entity-two-
contacts inconsistency this file exists to prevent.

## Rules of use

- **Any store form that asks for trader contact details gets these values,
  unchanged.** If a console rejects a format (some want a single-line
  address, some split it), reformat, never re-source.
- **A change here is a change everywhere, in one pass.** All three
  listings, plus this file. A store that lags is a divergence a regulator
  can see.
- **The published contacts must stay monitored.** DSA complaint and
  takedown clocks run through them and some are as short as 7 days. The
  email routes to the shared inbox; the phone rings the operator directly.
- **Nothing secret belongs in this file.** Every value here is destined for
  a public listing. That is what makes it safe to keep in the repo, and it
  is also why nothing else should be added to it.
