# Google Play listing pack (XChain Wallet, Android)

**Item:**  §8. **Status:** drafted 2026-07-31 (stage S4), not submitted.

Every string Play asks for lives here so a resubmission never improvises. When
a reviewer question changes an answer, it changes **here** first and the
console second; a console-only edit is how two versions of the truth start.

---

## Store name

    XChain Wallet

## Short description (80 characters max)

    Self-custody wallet for Bitcoin, Litecoin and Dogecoin. Your keys stay on your phone.

(84 characters with the trailing period; the submitted form is the sentence
without it, at 83. Trim to fit whatever the console counts. Shorter
alternative, 62 characters:)

    Self-custody Bitcoin, Litecoin and Dogecoin wallet. Your keys.

## Full description

XChain Wallet is a self-custody wallet. Your recovery phrase and your keys are
generated on your device, encrypted with your password, and never leave it. We
cannot see your balance, we cannot move your coins, and we cannot help you
recover a lost recovery phrase. That is what self-custody means, and it is
worth understanding before you start.

What you can do with it:

- Hold and send Bitcoin, Litecoin and Dogecoin.
- Hold and send tokens issued on the XChain protocol, and see their history.
- Scan a QR code to receive, to send, or to sign a transaction from a wallet
  kept offline.
- Unlock with your fingerprint instead of typing your password every time.

How your wallet is stored on this phone:

- The wallet file is encrypted with a key held in your device's hardware
  keystore. It never goes into cloud backup, and it does not transfer to a new
  phone (a copy would be unreadable there anyway, because the key cannot
  leave this device).
- Moving to a new phone means importing your recovery phrase. Write it down
  when the app shows it to you. There is no other copy.

What this app does not do:

- It does not hold your coins for you, and there is no account to sign into.
- It does not collect analytics, and there is no advertising.
- It is not an exchange, and it does not mine anything.

Open source, AGPL-3.0-or-later. Built by Dankest, LLC.

---

## Categorization and contact

| Field | Value |
|---|---|
| Category | Finance |
| Contact email (app listing) | `info@dankest.llc`. **Settled 2026-08-01 ( D1)**, and no longer conditional: this row used to say "support@xchain.io if/when  makes it deliverable", which left a retired address sitting in a field a human transcribes. `info@dankest.llc` is the one proven to receive mail and the one every other store publishes. If it is ever moved to `support@xchain.io`, that moves in `docs/Trader_Identity.md` and on every listing in the same pass |
| Website (app listing) | `https://xchain.io`. The  apex flip LANDED 2026-08-01 (it is what made the wallet privacy URL resolve at the apex instead of only at newsite.xchain.io), so this is no longer pending. The ACCOUNT-level website stays `https://dankest.llc` |
| Privacy policy | `https://dankest.llc/privacy.html` **WRITTEN AND DEPLOYED to origin-host 2026-08-01, but not yet reachable: the dankest.llc DNS still points at the old host.** One A-record change makes it live. See PLAY_ENROLLMENT.md. |

## Trader declaration (EU DSA)

Trader. Same entity as the Chrome Web Store listing, and it appears publicly:

    Dankest, LLC
    30 N Gould St Ste N
    Sheridan, WY 82801
    United States
    info@dankest.llc
    +1 949-510-5364

**Settled in full 2026-08-01 (operator,  D1).** The address is a
registered agent's, which is why publishing it permanently is not the exposure
a home address would be. The phone is the operator's personal mobile, published
by explicit decision after the SIM-swap exposure was raised: a number tied
publicly to a named crypto company is a targeting signal, and the carrier
account behind it is a recovery path that hardware-key 2FA on the store
accounts does not cover. Recorded as a deliberate choice so nobody substitutes
a different number at the console. If it is ever replaced by a forwarding line
(a VOIP number ringing the same handset satisfies the DSA identically), the
swap lands on every store listing in one pass.

**Keep this consistent across stores.** The email question is settled:
`info@dankest.llc` is the one that demonstrably receives mail today (accepted
by Google from origin-host, arrival confirmed by the operator), and the older
`support@xchain.io` proposal in the Chrome spec lost. Two different public
trader contacts for one legal entity is the kind of small inconsistency that a
reviewer or a regulator notices, so the address block above is the one to
transcribe into every store form, this one included.

## Country availability

**DECIDED 2026-08-02 (operator): worldwide, minus the named exclusions below.**
This closes D8.

**The one thing to know before reading the list: this field is not permanent.**
Unlike the `applicationId` and the first `versionCode`, country availability is
editable in the Play Console at any time. The cost of starting conservative and
opening up later is a few clicks; the cost of starting open and being wrong is a
regulator. So the list errs toward exclusion where the law is unsettled.

### Tier 1: excluded, no further input needed

| Country / region | Why |
|---|---|
| **United Kingdom** | The financial-promotions regime is the reason crypto apps have been delisted there. This is the exposure D8 existed to name, and it is being declined rather than accepted. |
| Cuba, Iran, North Korea, Syria | Comprehensive US sanctions. Play does not distribute there in any case; excluding them explicitly means the listing states the position rather than relying on Google's list staying the same. |
| Crimea, Donetsk, Luhansk | Same, region-scoped. |
| Russia, Belarus | Sanctions plus Play's own payment restrictions. |
| Mainland China | Play is not available there. |

### Tier 2: excluded now, worth a legal look before opening up

A handful of jurisdictions have had outright bans or heavy restrictions on
crypto services, and the law in several of them has moved more than once in the
last few years. **Excluded at launch on that basis alone, not on a current legal
reading**, because the field is editable and re-opening a market is cheap:

Bangladesh, Nepal, Algeria, Egypt, Qatar, Bolivia, Morocco.

Whoever wants any of these opened should get a current answer for that specific
country rather than a general one. Nothing here blocks the build or the first
submission.

### The asymmetry being agreed to, stated plainly

**These exclusions bind the Play listing only.** The direct APK is
jurisdiction-blind by design, no geo-mechanism is proposed for it, and the
download page reaches every one of the countries above. That is the thing being
agreed to, not an oversight: the direct lane exists precisely so that the wallet
is reachable where a store's rules are not our rules.

---

## Financial features declaration

Play's financial-features form asks which apply. The answers:

| Question | Answer |
|---|---|
| Does the app offer crypto exchange or custody? | **No.** Non-custodial wallet only; keys never leave the device. |
| Does the app facilitate crypto trading? | **No.** No order book, no matching, no fiat on-ramp. |
| Does the app mine cryptocurrency? | **No.** |
| Does the app offer financial products or services? | **No.** It is a key-management tool. |

Attach the §313 review-defense narrative below to the declaration.

## Review notes (the free-text field reviewers read)

    XChain Wallet is a non-custodial cryptocurrency wallet. Keys are generated
    on the device, encrypted with a user-chosen password, and stored in
    app-private storage under an Android Keystore key. There is no account
    system, no server-side custody, and no exchange functionality.

    To review the app:
      1. Open it and choose "Create a wallet". Any password works.
      2. The app shows a recovery phrase and asks you to confirm it. This is
         the standard self-custody backup step.
      3. The wallet opens on the balances screen. Balances are read from a
         public blockchain indexer; no account is involved.
      4. "Receive" shows an address and a QR code. "Send" builds a transaction
         and asks for confirmation before broadcasting.

    A demo wallet on a test network is provided below so no real funds are
    needed. It is a testnet wallet: the coins in it have no monetary value.

## App access (the credentials field)

Provide the **demo wallet**, per the demo-data convention: a regtest/testnet
wallet, never a funded mainnet one. Fill in at submission time:

    Network:         testnet
    Recovery phrase: <FILL AT SUBMISSION - testnet only, never mainnet>
    Password:        <FILL AT SUBMISSION>

Rotate it after each review cycle; it is written down in a store console.

---

## Graphics checklist

⬜ App icon 512×512 PNG (32-bit, alpha)
⬜ Feature graphic 1024×500
⬜ Phone screenshots, at least 2 (the responsive UI makes these cheap):
   balances, receive with QR, send confirmation, settings showing biometric
   unlock
⬜ 7-inch and 10-inch tablet screenshots if the listing claims tablet support
⬜ No screenshot may show a real mainnet address holding real funds

## Data safety form

Answers live in `DATA_SAFETY.md` next to this file, derived from the audited
wire list rather than from intent.
