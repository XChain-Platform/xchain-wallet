# XChain Wallet privacy policy

<!--
INTERNAL STATUS. Everything between this comment and the next one is for
maintainers and never reaches a published page: xchain-websites'
build/privacy.build.js strips every HTML comment before rendering.

DRAFT, not yet publishable. Every statement about the wallet itself is
verified against the code. What our servers keep was measured on the live
hosts 2026-08-01 (combined access logs including client IP, rotated daily,
kept 14 days; Cloudflare fronts the xchain.io hosts and keeps its own).

TWO ITEMS REMAIN, and both are decisions rather than facts. Both are
tracked in docs/Data_Collection.md and owned by:

  1. SETTLED 2026-08-01 (operator, D1). The data controller of record is
     Dankest, LLC, the publisher name registered on both stores, and the
     privacy contact is privacy@dankest.llc, which was CREATED that day and
     proven to receive: a message from origin-host was accepted by Google
     (250 2.0.0 OK via aspmx.l.google.com) and confirmed as arrived by the
     operator. The address had been published here since 2026-04 without
     anyone checking it existed, which is the failure this closes. Still do
     not change it in this file alone: it is one of five identity surfaces
     that have to agree, and reviewers cross-check them.
  2. PENDING (jurisdiction-specific sections). Whether a GDPR lawful-basis
     statement or a CCPA notice is required depends on where the company
     operates and where the apps are listed. No such section is published
     today, in this document or in the extension policy it replaced.

Neither is a hole in the text below. The text states what is true today;
the remaining note records that one omission is provisional. Nothing in the
published text changed when item 1 settled, because the text already named
Dankest, LLC and privacy@dankest.llc: the decision confirmed what was
published rather than altering it.

A studio-wide policy covering this same ground was published for Dankest,
LLC on 2026-08-01 (~/Sites/dankest.llc, page privacy.html). THE TWO MUST
NOT DRIFT: that one covers the company, this one covers the wallet, and a
store listing points at this one.

Source of record for the facts here: docs/Data_Collection.md. Change that
file first, then this one.

ONE POLICY, EVERY SHELL (2026-08-01). This document replaced the separate
packages/extension/PRIVACY_POLICY.md, which described only the Chrome
extension. Anything that is true of one shell and not another is said in
its own section below, by name. When you add a shell, add its section; a
shell with no section is a shell whose users are reading claims that were
written about somebody else's build.
-->

**Publisher:** Dankest, LLC  
**Applies to:** XChain Wallet in every form we ship: the web wallet, the browser extension, the desktop app for Windows, macOS and Linux, and the Android and iOS apps.  
**Last updated:** 1 August 2026

---

## The short version

We do not collect your data. There is no account to create, no analytics, no crash reporting, and no server of ours that stores anything about you.

Your recovery phrase, your private keys and your password never leave your device. We could not access your funds if we wanted to, and we cannot help you recover them if you lose your recovery phrase.

There is one thing you should understand, because it is true of every wallet and most are quiet about it: to show you your balance, the wallet has to ask a server about your addresses. That tells the server which addresses you are interested in. The rest of this document is mostly about that.

It is the same wallet everywhere. The web version, the browser extension, the desktop app and the phone apps are built from one codebase, so what follows applies to all of them unless a section says otherwise.

## What stays on your device

- Your recovery phrase and every key derived from it
- Any private key you import
- Your password
- Your labels, address book and settings
- The list of sites you have connected the wallet to, and what you approved for each

These are encrypted on your device with a key derived from your password. We never receive them, in any form, at any time. There is no backup on our servers, because there are no servers that hold user data.

Where that encrypted data physically sits depends on which version you installed:

- **Web wallet:** in your browser's own storage for this site, on this device.
- **Browser extension:** in `chrome.storage.local`, which is visible only to the extension and lives inside your browser profile.
- **Desktop app:** in the application's data directory on your computer.
- **Android:** in the app's private storage, with the key held in the Android Keystore.
- **iOS:** in the app's private container, with the key held in the iOS Keychain and marked so it cannot travel to another device.

## What leaves your device, and where it goes

**Your addresses go to a blockchain explorer.** To show balances and history, the wallet asks `explorer.xchain.io` about the addresses in your wallet. To prepare a transaction, it sends the addresses and amounts involved to `encoder.xchain.io`. These services run on our infrastructure. They see the addresses you hold and, like any web request, the IP address you connect from.

You can point the wallet at a different explorer or encoder in Settings, including one you run yourself. If you do, that operator sees this instead of us.

**Configuration lookups.** On startup the wallet fetches chain settings from `hub.xchain.io`. This sends no information about you or your wallet beyond your IP address. The response is cryptographically signed and rejected if it does not verify.

**Fiat values, from our own price oracle first.** To show what an amount is worth in your currency, the wallet reads the on-chain PRICE oracle through the explorer API described above. Only when that feed is stale or unreachable does it fall back to CoinGecko. When both are unavailable the wallet shows no fiat value rather than a made-up one.

**Coin statistics, from CoinGecko directly.** When you open the detail page for Bitcoin, Litecoin or Dogecoin, the wallet asks `api.coingecko.com` for price, market cap, 24-hour change and a 7-day chart, for all three coins in one batched request, and caches the answer (5 minutes for the figures, 1 hour for the chart) so most visits make no request at all. This sends no addresses and no amounts, but it does tell CoinGecko your IP address and that a wallet is in use. No request is made on test networks. **You can turn this off** in Settings under Privacy, which stops these requests entirely and hides the statistics. CoinGecko's handling of the request is governed by their own privacy policy.

**Token information, from whoever issued the token.** Some tokens publish a link to their own information document as part of their on-chain record. When you view such a token, the wallet follows that link and renders whatever artwork, audio, video, website and social links it embeds, resolving `ipfs://` and `ar://` links through the public gateways `ipfs.io` and `arweave.net`. The server at the other end, and the host of any embedded media, is chosen by the token's issuer, not by us and not by you, and it can see that someone at your IP address looked at that token. **You can turn this off** in Settings under Privacy, which shows only the on-chain fields and makes no extra request.

**Block-explorer icons, and this one has no switch.** The transaction detail view offers "view on explorer" links to third-party block explorers, and loads each explorer's icon image to show beside its link. Depending on the coin, that means a request to `mempool.space`, `blockstream.info`, `litecoinspace.org`, `blockchair.com` or `blockcypher.com`. These happen whenever a transaction detail view is rendered on a live network, before you click anything, and there is currently no setting to stop them. Each of those hosts learns your IP address and that you opened a transaction view. We are naming it here because it is the one contact in this list you cannot switch off.

**Hardware wallets, if you use one.** Ledger devices connect directly over USB or WebHID and involve no network service at all. Trezor is different: pairing one loads software from `connect.trezor.io`, and your interaction with the device passes through it, under SatoshiLabs' own privacy policy. That contact can only happen in the web wallet and the desktop app. The browser extension ships no Trezor support at all, and the phone apps are built with a content security policy that does not permit `connect.trezor.io` to load, so no request reaches it there either.

**Restoring from a backup link, if you use one.** If you restore a wallet from a link you provide, the wallet downloads from that address. You choose it, we never see it, and the file it fetches is already encrypted with your password. Only `https` links are accepted.

**Update checks.** These differ by version and are described in each section below. Where the wallet checks for updates, the request carries nothing but the request: no wallet address, no identifier, no account.

**What our servers keep.** Measured on the live hosts on 1 August 2026, not assumed. `explorer.xchain.io`, `encoder.xchain.io`, `hub.xchain.io` and `downloads.xchain.io` each write an Apache access log in the standard "combined" format: your IP address, the time, the request, the response status, the referring page, and your browser's user-agent string. Those logs rotate **daily and are kept for 14 days**, then they are deleted. No account is attached to them, because there are no accounts, and we do not correlate them across services or use them to build a picture of a person.

One thing we cannot control, so you should know it: those hosts sit behind **Cloudflare**, which absorbs attacks on our behalf. Cloudflare therefore sees requests to them and keeps its own logs under its own policy. Our company site, dankest.llc, is served directly and does not go through them.

## The web wallet

The web wallet runs in your browser at our address. It asks for no browser permissions up front. The camera is requested only if you use the QR scanner, through your browser's standard permission prompt, and the video is decoded in the page and never recorded or sent anywhere.

Because it is a web page, everything it stores lives in your browser's storage for our site. Clearing that site's data removes your wallet from this browser. Make sure you have your recovery phrase before you do that, because we cannot restore it for you.

Updates are not something the web wallet checks for. You always load the current version when you open the page.

## The browser extension

The extension is the same wallet, running inside your browser with a small set of declared permissions. It requests **no** `host_permissions`, which means no blanket access to the pages you visit.

- **`storage`** stores the encrypted wallet material, settings and site approvals described above, on your device.
- **`sidePanel`** lets you open the wallet in the browser's side panel instead of the toolbar popup. It shows the same wallet and the same data.
- **`notifications`** shows a browser notification for a background event you configured, such as a price alert or a payment deadline. The content is generated on your device from data already on your device and is not sent anywhere.
- **`alarms`** wakes the extension's background worker every few seconds. Chrome shuts an idle worker down after about 30 seconds, and without this the auto-lock timer and background watchers would silently stop.
- **A content script** runs on secure sites (`https://*/*`) plus `http://localhost/*` and `http://127.0.0.1/*` for local development. It injects the `window.xchain` provider so a site can ask the wallet to connect or to sign. It does not read the page. It deliberately does not run on other plain-HTTP sites, because on a page served without TLS an attacker on the network can rewrite the page and impersonate the site.
- **`web_accessible_resources`** exposes two static things to pages that load them: the provider script above, and a set of coin icons a connected site can display. Neither carries wallet data.

**No site gets anything until you approve it.** The first time a page asks, the wallet shows a prompt naming that exact site; only sites you approved receive an address or a signing request, and you can revoke any of them in Settings. The provider being present on a page grants that page nothing.

The extension supports Ledger and software signing only. It does not support Trezor, because Trezor's SDK requires loading vendor-hosted code at runtime and the extension platform's rules do not allow that.

Updates are handled by the browser's extension store, not by us.

**Single purpose.** The single purpose of the extension is to let you hold and move XChain Platform assets (Bitcoin, Dogecoin, Litecoin, and their XChain-issued tokens) self-custodially from within the browser, and to sign XChain actions on behalf of sites you connect to.

**Limited use.** Our use of information received from Google APIs will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements. The extension does not use Google APIs and does not process Google user data. This statement is here because the Chrome Web Store listing form requires it.

## The desktop app

**Update checks.** The desktop app asks `downloads.xchain.io` whether a newer version exists. This tells us your IP address and which version you are running. Nothing is downloaded or installed without you choosing to, and an update is only installed if its signature verifies.

**Routing through Tor.** The desktop app can send all of its network traffic through a local Tor proxy, so the servers above see Tor rather than your address. It is off unless you turn it on, in Settings under Privacy, and you need Tor already running on your machine.

Two things worth knowing:

- When it is on, **everything** listed above goes through it, including the price and token-information requests to third parties, and the update check.
- If Tor is not running, requests **fail** rather than quietly going out directly. We would rather show you an error than let you believe you are protected when you are not.

This is not available in the web wallet or the browser extension, and we do not offer it there. A web page cannot use a proxy like this at all, and a browser extension could only redirect **all** of your browsing rather than just the wallet's requests, which is not a thing we are willing to do to your browser.

## The Android app

The Android app is the same wallet, wrapped so it can be installed. A few things work differently there, and they are the things worth knowing before you install it.

**The camera.** The app asks for camera permission the first time you scan a QR code, and only then. The camera feed is decoded on your phone, frame by frame, and nothing is photographed, saved, or sent anywhere. Say no and every other part of the wallet still works; you just type or paste instead of scanning.

**Your fingerprint.** If you turn on biometric unlock, your phone's hardware stores an encrypted copy of your wallet password, and it will only release that copy after your fingerprint or face is checked, once, for that one unlock. The wallet never sees your fingerprint: Android does the checking and only tells us yes or no. Adding a new fingerprint to your phone destroys the stored copy on purpose, so you go back to typing your password until you turn it on again.

**Backups, and why there are none.** The app tells Android **not** to include it in cloud backup and **not** to transfer during device-to-device setup. This is deliberate twice over. Your wallet file is encrypted with a key that physically cannot leave your phone, so a restored copy on a new phone would be unreadable anyway. And the rest of it, your settings, your address book, the sites you connected to, is not something we want sitting in anyone's cloud.

The consequence is worth stating plainly: **moving to a new phone means importing your recovery phrase.** If you have not written it down, a lost phone is a lost wallet. That is the trade every self-custody wallet makes, and we would rather you read it here than discover it later.

**Screenshots.** On the screens that show your recovery phrase or a private key, and on the unlock screen, the app tells Android to block screenshots and screen recording. That also keeps those screens out of the thumbnail Android saves when you switch apps, which is written to your phone's storage. Everywhere else, screenshots work normally, because sending someone a picture of your receive code is a perfectly ordinary thing to do.

**Update checks (only if you installed the APK directly).** If you installed from Google Play, Play handles updates and this does not apply. If you downloaded the APK yourself, the app checks a single static file at `downloads.xchain.io` at most once a day to see whether a newer version exists. All it can learn is that some device somewhere checked. The wording of any notice you see is written into the app itself, not fetched, and nothing is ever downloaded or installed automatically. You can switch the check off in Settings.

## The iOS app

The iOS app is the same wallet, wrapped the same way, and the differences are Apple's rather than ours.

**The camera.** Asked for the first time you scan a QR code, and only then, through the standard iOS prompt. The feed is decoded on your device and nothing is photographed, saved, or sent anywhere.

**Face ID and Touch ID.** If you turn on biometric unlock, an encrypted copy of your wallet password is stored in the iOS Keychain, released only after Face ID or Touch ID succeeds, once, for that one unlock. The wallet never sees your face or fingerprint: iOS does the checking and tells us only yes or no. Face ID never approves a transaction on its own; signing always asks you separately. Enrolling a new face or finger invalidates the stored copy on purpose, so you go back to typing your password until you turn it on again.

**iCloud, and why your wallet is not in it.** The key that opens your wallet is stored so it cannot leave this device and cannot travel to iCloud Keychain, and the wallet's own files are marked to be left out of iCloud and iTunes backups. The same consequence as on Android follows: **moving to a new iPhone means importing your recovery phrase.**

**Screenshots.** iOS gives an app no way to block screenshots or screen recording the way Android does, so we do not claim to. Treat your recovery phrase screen accordingly: do not screenshot it, because that image goes to your photo library and, if you have it enabled, to iCloud.

**Updates** are handled by the App Store, not by us.

## What we never do

- We do not use analytics, telemetry or crash reporting of any kind.
- We do not show ads and we do not include any advertising or tracking software.
- We do not sell or share your data. There is nothing to sell.
- We do not ask for your name, email address, phone number or location.
- We do not track you across websites or apps. The browser extension requests no permission to read the pages you visit.
- We do not load code at runtime from anywhere. Every version ships the code it runs.

## The donation setting

The wallet has an optional feature that adds a small donation to transactions you send, to fund development. We ask you about it once during setup, and you can change it any time in Settings.

If you enable it, it changes the transaction you were already making by adding one output. It sends no information anywhere and makes no additional network request. It is not advertising and involves no third party.

## Children

XChain Wallet is not designed for or directed at children. It is a tool for holding your own cryptocurrency, and we do not knowingly collect information from anyone, including children.

## Your choices

Because we hold no data about you, the usual requests (access, deletion, correction) have nothing to act on. What you can control is what leaves your device:

- Turn off coin statistics in Settings under Privacy, which stops the requests to CoinGecko.
- Turn off token information fetching in Settings under Privacy.
- Point the explorer and encoder at your own servers in Settings.
- Turn off notifications, which ends the live connection to the explorer.
- On the desktop app, route everything through Tor.
- Avoid the transaction detail view if you would rather not load block-explorer icons, since that one has no setting.
- Uninstall the app, or clear the site's data in the web wallet. Everything it stored is on your device and goes with it, and there is no server copy to delete. Make sure you have your recovery phrase first, because we cannot restore it for you.
- Export your recovery phrase and private keys at any time, from Settings under Security, after re-entering your password. They are yours and the wallet does not hold them hostage.

## Changes to this policy

If this changes we will update this page and the date at the top. The version history is public in the wallet's source repository, so you can see exactly what changed and when.

## Contact

Questions or complaints about privacy: email <privacy@dankest.llc>, or open an issue at <https://github.com/XChain-Platform/xchain-wallet/issues>.

Security issues have their own channel: see `SECURITY.md` in the source repository. Please report those there rather than here.
