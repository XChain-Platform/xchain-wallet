<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright © 2026 Dankest, LLC -->

# XChain Wallet — Privacy Policy

Last updated: 2026-04-24  
Applies to: XChain Wallet browser extension (Chrome, Edge, Brave, any Chromium-based browser that supports the Chrome Web Store listing).

## Summary

XChain Wallet is a self-custodial cryptocurrency wallet. It does not collect, transmit, sell, or share personally identifiable information. All private keys, seeds, addresses, contacts, and settings live on the device that installed the extension. There is no server-side user account, no telemetry, and no third-party analytics.

## What the extension stores on your device

The extension writes to `chrome.storage.local`, which is visible only to the extension itself and lives inside the browser profile. The following categories are stored:

- **Encrypted wallet material.** Your seed, derived private keys, and BIP39 passphrase (if set) are stored encrypted with a key derived from your wallet password via Argon2id. The extension never stores the password itself.
- **Public data.** Addresses, transaction history metadata, token/contract identifiers, multisig configurations, contacts, and UI preferences.
- **dApp connection grants.** The list of origins you have granted read/sign access to, along with the per-origin approvals you configured.
- **Operational state.** Queued PSBTs, multisig coordination state, approval-broker session data.

None of the above is transmitted off-device by the extension.

## What the extension sends off your device, and why

The extension communicates with two kinds of remote endpoints, both of which you configure:

- **Blockchain RPC endpoints.** To read balances, broadcast transactions, fetch on-chain data, and query the XChain Platform's decoder / indexer / explorer services. Requests carry the addresses and transactions you are acting on. The RPC operator can see these requests. The operator is chosen by you in the wallet's settings and can be changed or pointed at a self-hosted node.
- **Hardware-wallet vendor bridges (optional).** If you pair a Trezor or Ledger device, the extension uses the vendor's SDK (Trezor Connect, Ledger Transport) to talk to the device over WebUSB / WebHID. Requests never leave the local browser.

No analytics endpoint, crash-reporting endpoint, advertising endpoint, or first-party server is contacted by the extension.

## Permissions and what they are used for

- **`storage`** — read and write the encrypted wallet material + public data + dApp grants described above.
- **`content_scripts` on `http://*/*` and `https://*/*`** — inject the `window.xchain` provider so dApps can request account information and transaction signatures from the wallet. The injected provider proxies requests to the wallet's background service worker through an isolated message channel; the wallet never reads page content.
- **`web_accessible_resources`** — exposes the injected provider bundle to pages that load it.

The extension requests no `host_permissions` (no blanket host access beyond what content-script matches expressly grant), no `tabs`, no `webRequest`, no `clipboardRead`, no `cookies`, no `identity`, no `bookmarks`, no `downloads`.

## Camera access

The multisig PSBT-QR paste-inbox includes an optional camera scanner. Camera access is requested at runtime via the browser's standard `getUserMedia` permission prompt, only when you click "Scan". The camera stream is decoded locally with the browser's `BarcodeDetector` API and is never recorded, stored, or transmitted. Closing the scanner releases the stream.

## Children

XChain Wallet is not directed at children under 13. We do not knowingly collect data from anyone, including children.

## Third parties

The wallet does not integrate any third-party analytics SDK, advertising SDK, attribution SDK, or crash-reporting SDK. It does not load remote code at runtime. Hardware-wallet vendor SDKs (Ledger, Trezor) are bundled with the extension at build time and communicate only with a locally attached device.

## Data sales and transfers

We do not sell your data. We do not transfer your data to a third party. Since the extension does not collect your data in the first place, there is nothing for us to sell or transfer.

## Your control

- **Export.** Your seed phrase and private keys can be exported from the wallet's Settings → Security screen after re-entering your password.
- **Deletion.** Uninstalling the extension permanently removes every wallet stored on that browser profile (encrypted material + addresses + contacts + dApp grants). There is no server copy to delete.
- **Contact.** Questions or complaints: open an issue at <https://github.com/XChain-platform/xchain-wallet/issues> or email <privacy@dankest.llc>.

## Chrome Web Store — single-purpose disclosure

The single purpose of the XChain Wallet extension is to let a user hold and move XChain Platform assets (Bitcoin, Dogecoin, Litecoin, and their XChain-issued tokens) self-custodially from within the browser, and to sign XChain actions on behalf of dApps the user connects.

## Chrome Web Store — limited-use disclosure

Our use of information received from Google APIs will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements. The extension does not use Google APIs and does not process Google user data. This disclosure is included because the CWS listing form requires an affirmative statement.

## Changes to this policy

Material changes to this policy will be announced in the extension's release notes and updated at this document's URL before the corresponding extension version is published to the Chrome Web Store.
