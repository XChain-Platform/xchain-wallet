<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright © 2026 Dankest, LLC -->

# XChain Wallet - Privacy Policy

**This file is no longer the policy. The policy is [`docs/Privacy_Policy.md`](../../docs/Privacy_Policy.md), and it covers every shell.**

Until 2026-08-01 this file held a privacy policy written for the Chrome extension alone, while `docs/Privacy_Policy.md` held a second one covering the web and desktop wallets. Two policies for one wallet is how they come to disagree, and a store rejects a listing whose policy disagrees with its data-disclosure answers. There is one document now, and it says which shell each claim applies to.

What moved into it from here, because this file was the only one that had it:

- the CoinGecko coin-statistics request and its opt-out, kept separate from the fiat-conversion path that prefers our own on-chain oracle
- the token-metadata fetch, including the `ipfs.io` and `arweave.net` gateways it resolves through
- the five block-explorer icon hosts a transaction detail view loads, which have no opt-out at all
- the per-permission explanations, the content-script match list, and the ConnectedSites approval model
- why the extension ships no Trezor support
- the Chrome Web Store single-purpose and limited-use disclosures

The Chrome Web Store data-disclosure form is checked against `docs/Privacy_Policy.md`, and `https://xchain.io/wallet/privacy/` is generated from it by `xchain-websites/xchain.io/build/privacy.build.js`. This file is a signpost, not a second copy: do not restore prose here.
