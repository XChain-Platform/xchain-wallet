# XChain Wallet privacy policy

> **DRAFT, not yet publishable.** Every statement about the wallet
> itself is verified against the code. What is missing is what happens
> at the other end: whether our own servers keep logs, and for how long.
> Three items are marked **[UNSETTLED]** below and are listed in
> `docs/Data_Collection.md`. Every store submission is hard-blocked on a
> live URL for this document, so settling them is on the critical path.
>
> Source of record for the facts here: `docs/Data_Collection.md`. Change
> that file first, then this one.

**Publisher:** Dankest, LLC
**Applies to:** XChain Wallet in every form we ship: the web wallet, the
Chrome extension, and the desktop app for Windows, macOS and Linux.
**Last updated:** [UNSETTLED: publication date]

---

## The short version

We do not collect your data. There is no account to create, no analytics,
no crash reporting, and no server of ours that stores anything about you.

Your recovery phrase, your private keys and your password never leave
your device. We could not access your funds if we wanted to, and we
cannot help you recover them if you lose your recovery phrase.

There is one thing you should understand, because it is true of every
wallet and most are quiet about it: to show you your balance, the wallet
has to ask a server about your addresses. That tells the server which
addresses you are interested in. The rest of this document is mostly
about that.

## What stays on your device

- Your recovery phrase and every key derived from it
- Any private key you import
- Your password
- Your labels, address book and settings

These are encrypted on your device with a key derived from your
password. We never receive them, in any form, at any time. There is no
backup on our servers, because there are no servers that hold user data.

## What leaves your device, and where it goes

**Your addresses go to a blockchain explorer.** To show balances and
history, the wallet asks `explorer.xchain.io` about the addresses in
your wallet. To prepare a transaction, it sends the addresses and
amounts involved to `encoder.xchain.io`. These services run on our
infrastructure. They see the addresses you hold and, like any web
request, the IP address you connect from.

You can point the wallet at a different explorer or encoder in Settings,
including one you run yourself. If you do, that operator sees this
instead of us.

**Configuration lookups.** On startup the wallet fetches chain settings
from `hub.xchain.io`. This sends no information about you or your
wallet beyond your IP address. The response is cryptographically signed
and rejected if it does not verify.

**Coin prices, from a third party.** When you view a coin's page, or
while you have a price alert armed, the wallet may ask CoinGecko for a
price. This sends no addresses and no amounts, but it does tell
CoinGecko your IP address and which coins you looked at. The wallet
tries our own price feed first and only falls back to CoinGecko. **You
can turn this off** in Settings under Privacy. CoinGecko's handling of
that request is governed by their own privacy policy.

**Token information, from whoever issued the token.** Some tokens
publish a link to their own information page as part of their on-chain
record. When you view such a token, the wallet follows that link. The
server at the other end is chosen by the token's issuer, not by us and
not by you, and it can see that someone at your IP address looked at
their token. **You can turn this off** in Settings under Privacy.

**Trezor, if you use one.** Pairing a Trezor loads software from
`connect.trezor.io`, and your interaction with the device passes through
it. That is SatoshiLabs' service under SatoshiLabs' privacy policy. This
applies to the web and desktop wallets. Ledger devices connect directly
over USB and involve no network service at all.

**Restoring from a backup link, if you use one.** If you restore a
wallet from a link you provide, the wallet downloads from that address.
You choose it, we never see it, and the file it fetches is already
encrypted with your password. Only `https` links are accepted.

**Update checks, on the desktop app.** The desktop app asks
`downloads.xchain.io` whether a newer version exists. This tells us your
IP address and which version you are running. Nothing is downloaded or
installed without you choosing to.

**[UNSETTLED: what our servers keep.]** This section must state whether
`explorer.xchain.io`, `encoder.xchain.io`, `hub.xchain.io` and
`downloads.xchain.io` record access logs, whether those logs contain IP
addresses, how long they are kept, and that Cloudflare sits in front of
them and keeps its own. Without this the paragraphs above describe what
we send but not what is kept, which is the part a reader actually wants.

## Routing through Tor (desktop app only)

The desktop app can send all of its network traffic through a local Tor
proxy, so the servers above see Tor rather than your address. It is off
unless you turn it on, in Settings under Privacy, and you need Tor
already running on your machine.

Two things worth knowing:

- When it is on, **everything** listed above goes through it, including
  the price and token-information requests to third parties, and the
  update check.
- If Tor is not running, requests **fail** rather than quietly going out
  directly. We would rather show you an error than let you believe you
  are protected when you are not.

This is not available in the web wallet or the browser extension, and we
do not offer it there. A web page cannot use a proxy like this at all,
and a browser extension could only redirect **all** of your browsing
rather than just the wallet's requests, which is not a thing we are
willing to do to your browser.

## What we never do

- We do not use analytics, telemetry or crash reporting of any kind.
- We do not show ads and we do not include any advertising or tracking
  software.
- We do not sell or share your data. There is nothing to sell.
- We do not ask for your name, email address, phone number or location.
- We do not track you across websites or apps. The browser extension
  requests no permission to read the pages you visit.

## The donation setting

The wallet has an optional feature that adds a small donation to
transactions you send, to fund development. We ask you about it once
during setup, and you can change it any time in Settings.

If you enable it, it changes the transaction you were already making by
adding one output. It sends no information anywhere and makes no
additional network request. It is not advertising and involves no third
party.

## Children

XChain Wallet is not designed for or directed at children. It is a tool
for holding your own cryptocurrency, and we do not knowingly collect
information from anyone, including children.

## Your choices

Because we hold no data about you, the usual requests (access, deletion,
correction) have nothing to act on. What you can control is what leaves
your device:

- Turn off price data in Settings under Privacy.
- Turn off token information fetching in Settings under Privacy.
- Point the explorer and encoder at your own servers in Settings.
- Turn off notifications, which ends the live connection to the explorer.
- Uninstall the app. Everything it stored is on your device and goes
  with it. Make sure you have your recovery phrase first, because we
  cannot restore it for you.

**[UNSETTLED: jurisdiction-specific sections.]** Whether a GDPR lawful
basis statement or a CCPA notice is required depends on where the
company operates and where the apps are listed. Decide before
publication.

## Changes to this policy

If this changes we will update this page and the date at the top. The
version history is public in the wallet's source repository, so you can
see exactly what changed and when.

## Contact

**[UNSETTLED: contact address for privacy questions.]** Confirm whether
this is `legal@dankest.llc` or a dedicated privacy address.

Security issues have their own channel: see `SECURITY.md` in the source
repository. Please report those there rather than here.
