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
| Contact email (app listing) | support@xchain.io if/when  makes it deliverable; otherwise info@dankest.llc |
| Website (app listing) | https://xchain.io once the  apex flip lands; the ACCOUNT-level website is https://dankest.llc and already serves 200 |
| Privacy policy | **UNPUBLISHED, blocks submission.** The text exists (docs/Privacy_Policy.md, incl. the S4 mobile section); dankest.llc/privacy is 404 and xchain.io/privacy is 403. See PLAY_ENROLLMENT.md. |

## Trader declaration (EU DSA)

Trader. Same entity as the Chrome Web Store listing, and it appears publicly:

    Dankest, LLC
    info@dankest.llc

**Keep this consistent across stores.** The Chrome Web Store spec ( §2)
still names support@xchain.io for the same declaration. Two different public
trader contacts for one legal entity is the kind of small inconsistency that a
reviewer or a regulator notices, so whichever address wins should win in both
places. info@dankest.llc is the one that demonstrably receives mail today.

## Country availability

**OPERATOR/LEGAL DECISION, NOT FILLED IN (D8).** The recommendation on record
is worldwide minus named exclusions, with the UK called out explicitly: the UK
financial-promotions regime has been the reason crypto apps were delisted, and
the decision needs a person who can accept that exposure.

State plainly when signing off: **the exclusions bind the Play listing only.**
The direct APK is jurisdiction-blind by design, no geo-mechanism is proposed
for it, and that asymmetry is the thing being agreed to, not an oversight.

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
