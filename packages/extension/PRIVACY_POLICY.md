<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright © 2026 Dankest, LLC -->

# XChain Wallet - Privacy Policy

Last updated: 2026-07-31  
Applies to: XChain Wallet browser extension (Chrome, Edge, Brave, any Chromium-based browser that supports the Chrome Web Store listing).

## Summary

XChain Wallet is a self-custodial cryptocurrency wallet. It does not collect, transmit, sell, or share personally identifiable information. All private keys, seeds, addresses, contacts, and settings live on the device that installed the extension. There is no server-side user account and no third-party analytics SDK. A small number of optional, mostly on-by-default convenience features do reach third-party services (price data, token artwork, block-explorer icons); each one is named, with its toggle where one exists, in "What the extension sends off your device, and why" below.

## What the extension stores on your device

The extension writes to `chrome.storage.local`, which is visible only to the extension itself and lives inside the browser profile. The following categories are stored:

- **Encrypted wallet material.** Your seed, derived private keys, and BIP39 passphrase (if set) are stored encrypted with a key derived from your wallet password via Argon2id. The extension never stores the password itself.
- **Public data.** Addresses, transaction history metadata, token/contract identifiers, multisig configurations, contacts, and UI preferences.
- **dApp connection grants.** The list of origins you have granted read/sign access to, along with the per-origin approvals you configured.
- **Operational state.** Queued PSBTs, multisig coordination state, approval-broker session data.

None of the above is transmitted off-device by the extension.

## What the extension sends off your device, and why

The extension communicates with the following remote endpoints:

- **Blockchain RPC endpoints.** To read balances, broadcast transactions, fetch on-chain data, and query the XChain Platform's decoder / indexer / explorer services. Requests carry the addresses and transactions you are acting on. The RPC operator can see these requests. The operator is chosen by you in the wallet's settings and can be changed or pointed at a self-hosted node.
- **Hardware-wallet vendor bridge (optional).** If you pair a Ledger device, the extension uses Ledger's transport SDK to talk to the device over WebHID / WebUSB. Requests never leave the local browser and go only to the device physically attached to it. The extension does not support Trezor: Trezor's SDK requires loading vendor-hosted code at runtime, which Manifest V3 does not allow. (The separate XChain web and desktop wallets do support Trezor; this policy covers only the browser extension.)
- **Native coin price data (`api.coingecko.com`, on by default).** When you open a Bitcoin, Litecoin, or Dogecoin detail page, the wallet requests USD price, market cap, 24-hour change, and a 7-day chart from CoinGecko for all three coins in one batched call, and caches the result (5 minutes for price data, 1 hour for the chart) so most visits don't trigger a new request. This reveals to CoinGecko that this wallet is in use, though not which address or amount. No request is made on testnet or regtest. Controlled by the "Native coin price data" toggle in Settings → Privacy; turning it off stops these requests entirely and hides the price stats on the detail page.
- **Token metadata and embedded media (on by default).** When a token's on-chain description points at a Token Information Standard (TIS) JSON document, the wallet downloads it and renders whatever artwork, audio, video, website, and social links it embeds, including resolving `ipfs://` and `ar:` links through the public gateways `ipfs.io` and `arweave.net`. This reveals to the host of that document, and to the host of any embedded media URL, that you're looking at that specific token. Those hosts are chosen by whoever issued the token, not by us. Controlled by the "Fetch token metadata" toggle in Settings → Privacy; turning it off shows only the on-chain fields with no extra network calls.
- **External block-explorer favicons.** The transaction history detail view offers "view on explorer" links to third-party block explorers (for example mempool.space, blockstream.info, litecoinspace.org, blockchair.com, blockcypher.com, depending on the coin), and loads each explorer's favicon image to show next to its link. These favicon requests happen whenever a history detail view renders on mainnet or testnet (not on regtest); there is currently no setting to turn them off.

No analytics SDK, crash-reporting SDK, advertising SDK, or first-party server is contacted by the extension, and we do not sell or transfer what little the endpoints above can infer from a request reaching them.

## Permissions and what they are used for

- **`storage`** - read and write the encrypted wallet material + public data + dApp grants described above.
- **`sidePanel`** - lets you open the wallet in the browser's side panel as an alternative to the popup, so it can stay visible alongside a page you're browsing. It shows the same wallet UI and reads and writes the same on-device data described above; it does not add any new data collection.
- **`notifications`** - shows a native browser notification for background wallet events you've configured (for example, a price alert, a governance poll update, a payment deadline, or a dispenser-escrow event) so you see it even with the popup closed. Notification content is generated on-device from data already on-device and is never sent anywhere.
- **`alarms`** - schedules a recurring wake-up (about every 24 seconds) for the extension's background service worker. Chrome shuts an idle service worker down after roughly 30 seconds, so without this the wallet's background watchers (price/notification polling, the auto-lock timer) would silently stop; the alarm just keeps that worker alive and does not collect or transmit any data itself.
- **Content script on `https://*/*`, plus `http://localhost/*` and `http://127.0.0.1/*`** - inject the `window.xchain` provider so dApps can request account information and transaction signatures from the wallet. The injected provider proxies requests to the wallet's background service worker through an isolated message channel; the wallet never reads page content. Every site must be individually approved by you before the wallet responds to it (the ConnectedSites model): injection alone grants a page nothing.
- **`web_accessible_resources`** - exposes two things to pages that load them: the injected provider bundle (`inject/xchainProvider.js`) that a dApp uses to talk to the wallet, and a set of chain-icon images (`chain-icons/*`) that a connected dApp can use to show a recognizable icon for the coin it's dealing with. Neither carries wallet data; both are static assets shipped in the extension bundle.

The extension requests no `host_permissions` (no blanket host access beyond what content-script matches expressly grant), no `tabs`, no `webRequest`, no `clipboardRead`, no `cookies`, no `identity`, no `bookmarks`, no `downloads`.

## Camera access

The multisig PSBT-QR paste-inbox includes an optional camera scanner. Camera access is requested at runtime via the browser's standard `getUserMedia` permission prompt, only when you click "Scan". The camera stream is decoded locally with the browser's `BarcodeDetector` API and is never recorded, stored, or transmitted. Closing the scanner releases the stream.

## Children

XChain Wallet is not directed at children under 13. We do not knowingly collect data from anyone, including children.

## Third parties

The wallet does not integrate any third-party analytics SDK, advertising SDK, attribution SDK, or crash-reporting SDK. It does not load remote code at runtime. Ledger's hardware-wallet vendor SDK is bundled with the extension at build time and communicates only with a locally attached device. (Trezor is not supported by this extension; see "What the extension sends off your device, and why" above.)

The third parties the extension can otherwise contact, all described in the section above, are: CoinGecko (native coin price data, on by default, toggleable), whatever host serves a token's Token Information Standard document plus any host that document points at for embedded media (token metadata, on by default, toggleable; the IPFS and Arweave public gateways are the most common such hosts), and the operators of the third-party block explorers linked from transaction history (favicon load, always on, no toggle). None of these receive your seed, keys, password, or wallet contents; each receives, at most, the fact that a request is being made and the on-chain identifier (address, token, or transaction hash) the request is about.

## Data sales and transfers

We do not sell your data. We do not transfer your data to a third party. Since the extension does not collect your data in the first place, there is nothing for us to sell or transfer.

## Your control

- **Export.** Your seed phrase and private keys can be exported from the wallet's Settings → Security screen after re-entering your password.
- **Deletion.** Uninstalling the extension permanently removes every wallet stored on that browser profile (encrypted material + addresses + contacts + dApp grants). There is no server copy to delete.
- **Contact.** Questions or complaints: open an issue at <https://github.com/XChain-platform/xchain-wallet/issues> or email <privacy@dankest.llc>.
<!-- D1 PENDING: spec claude/specs/wallet-publishing-chrome-extension.md §8 D1. Five public-identity surfaces must agree before first submission and don't today: publisher display name ("Dankest, LLC" vs "XChain"), verified domain (xchain.io), CWS listing support email (spec §2 proposes support@xchain.io), this policy's contact email (privacy@dankest.llc, above) plus the GitHub issues link, and the trader-declaration entity + published address/phone. Do not change the email/link above until D1 is decided as one unit; changing only this file would create a sixth disagreeing surface. -->

## Chrome Web Store - single-purpose disclosure

The single purpose of the XChain Wallet extension is to let a user hold and move XChain Platform assets (Bitcoin, Dogecoin, Litecoin, and their XChain-issued tokens) self-custodially from within the browser, and to sign XChain actions on behalf of dApps the user connects.

## Chrome Web Store - limited-use disclosure

Our use of information received from Google APIs will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements. The extension does not use Google APIs and does not process Google user data. This disclosure is included because the CWS listing form requires an affirmative statement.

## Changes to this policy

Material changes to this policy will be announced in the extension's release notes and updated at this document's URL before the corresponding extension version is published to the Chrome Web Store.
