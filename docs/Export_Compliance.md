# Encryption and export compliance

**Status: DRAFT.** The technical facts are verified against the code.
The classification conclusion is a legal judgment and is flagged as such
at the bottom.

**Item:**  §6c. **Audience:** whoever answers the encryption
questions on an app-store submission.

Apple asks about export compliance on every App Store submission, and
answering wrong is a rejection or worse. Google Play and the Chrome Web
Store ask less, but the answer must be the same one. This file is the
single stance so the three do not diverge.

---

## The question the stores are asking

Every store's encryption question reduces to two things: does the app
contain encryption, and if so, is it the ordinary published kind or
something that needs a licence.

**Yes, the wallet contains encryption**, and answering "no" would be
false. A self-custodial wallet is encryption software: it encrypts a
recovery phrase at rest and it signs transactions.

## What the wallet actually uses

All of it is standard, published, widely implemented cryptography. There
is no proprietary or in-house algorithm anywhere in the wallet.

| Purpose | Algorithm | Implementation |
|---|---|---|
| Encrypting the vault at rest | AES-256-GCM | `@noble/ciphers` |
| Deriving the vault key from the password | Argon2id (RFC 9106) | `@noble/hashes` |
| Transaction signing | ECDSA over secp256k1 | `@noble/curves`, `bitcoinjs-lib`, `ecpair` |
| Verifying the signed chain registry | Ed25519 | `@noble/curves` |
| Hashing | SHA-256 | `@noble/hashes` |
| Key derivation and mnemonics | BIP32, BIP39 | `@scure/bip32`, `@scure/bip39` |
| Address and data encoding | Base58, Bech32 | `@scure/base` |
| Desktop session key wrapping | OS-native (macOS Keychain, Windows DPAPI) | Electron `safeStorage` |

Two properties matter for the classification, and both hold:

1. **Every algorithm is a published standard.** AES, Argon2id,
   secp256k1, Ed25519, SHA-256, BIP32 and BIP39 are all publicly
   specified. Nothing is secret or novel.
2. **The implementation is open source.** The wallet is licensed
   AGPL-3.0-or-later and its source is published, as is every
   cryptographic library it uses. Nothing is a private fork.

The wallet is also not a general-purpose encryption product. It does not
encrypt user files or messages on demand; the cryptography exists to
protect the user's own keys and to sign their own transactions.

## The stance

**XChain Wallet uses only standard, publicly available cryptography,
implemented by open-source libraries, in published open-source code.**

That is the sentence every store answer should reduce to. It is verified
and can be stated without qualification.

## The part that is a legal judgment, not an engineering one

Whether that stance qualifies for a specific export exemption, and which
one, is a compliance decision this document does not make. Confirm
before the first submission:

1. **Which Apple answer applies.** App Store Connect asks whether the app
   uses exempt encryption. The open-source route (US EAR License
   Exception TSU / the publicly-available-encryption-source-code path)
   is the one that fits an AGPL wallet whose source is published, but
   whether to claim it, and whether the standard "limited to
   authentication and digital signature" exemption is the better fit,
   needs a compliance answer rather than an engineering one.
2. **Whether a source-code notification is owed.** The publicly-available
   route can carry a one-time notification obligation to the US Bureau
   of Industry and Security (and, for some filers, the NSA) naming where
   the source is published. If it applies, it is a one-time email, and
   the repository URL is the whole content. Confirm whether the project
   has already done this.
3. **Whether the annual self-classification report applies.** Some
   exemption routes carry a yearly reporting obligation. If ours does,
   record the deadline somewhere with an owner, because a yearly
   obligation with no owner is one nobody does. Note it in
   `claude/OPEN-ITEMS.md` with the date inline, not in a calendar
   nobody reads.
4. **Non-US jurisdictions.** The stores are global. Whether any listing
   country adds its own encryption declaration is a compliance question.

## Tor routing, and what it does not add

The desktop app can route its traffic through a local Tor SOCKS5 proxy
(, implemented 2026-07-31). This does not change the
classification above and does not add an encryption capability:

- The wallet speaks the SOCKS5 protocol to a proxy the **user** already
  runs. It does not bundle, ship or implement Tor, and it does not
  implement onion routing.
- SOCKS5 CONNECT carries no cryptography of its own. The TLS that
  protects the traffic is the same standard TLS described above,
  terminated at the real destination.

State it as "can use a user-supplied local SOCKS5 proxy", not as "ships
Tor". The distinction matters on a form asking what the app contains.

**Web and extension must not be described as offering it.** It exists
only on desktop; the toggle is hidden on the shells that cannot honour
it.
