// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ACTION lists for the chain registry. Source:
// xchain-documentation/protocol/actions/ + action-manifest.json.
//
// Two distinct contracts live here; keep them apart:
//   1. COMMON_ACTIONS / BTC_EXCLUSIVE_ACTIONS are the AUTHORABLE sets: the
//      actions the wallet surfaces a native authoring form for. Their union
//      is bound to the manifest's `walletForm` slice by
//      test/unit/ActionManifestConformance.test.js.
//   2. PROTOCOL_ONLY_ACTIONS are protocol-accepted (wire-decoded, indexed,
//      user-encodable) but deliberately have NO wallet authoring surface
//      (plumbing actions; §38 surfacing principle). They still belong in
//      ChainDescriptor.supportedActions, which advertises what the chain's
//      protocol accepts (a Phase/release-independent capability surface),
//      not which forms the UI renders. Bound to the manifest's
//      userEncodable-without-walletForm slice by the same conformance guard.

export const COMMON_ACTIONS = /** @type {const} */ ([
    'ADDRESS',
    'AIRDROP',
    'BATCH',
    'BET',
    'BROADCAST',
    'CALLBACK',
    'COINPAY',
    'DESTROY',
    'DISPENSER',
    'DIVIDEND',
    'FILE',
    'ISSUE',
    'LINK',
    'LIST',
    'MESSAGE',
    'MINT',
    'ORDER',
    'PRICE',
    'SEND',
    'SLEEP',
    'SWAP',
    'SWEEP',
    'VOTE',
]);

// Actions available only on Bitcoin at launch: staking (STAKE/UNSTAKE/
// DELEGATE for rotate+revoke / COLLECT) and smart contracts
// (DEPLOY/EXECUTE/DEPOSIT/WITHDRAW). Per §Phase 4 and SPEC §1.
export const BTC_EXCLUSIVE_ACTIONS = /** @type {const} */ ([
    'COLLECT',
    'DELEGATE',
    'DEPLOY',
    'DEPOSIT',
    'EXECUTE',
    'STAKE',
    'UNSTAKE',
    'WITHDRAW',
]);

// Protocol-accepted on every chain, form-less by design (see header note 2).
// ADDRESS moved OUT of this list in PC-32: v0 preferences got a real form
// (AddressPreferencesForm) and v1 controller-bind already had one
// (ControllerBindForm), so it is authorable on every chain. (The old note
// claiming the messaging flows emit ADDRESS was wrong; only controllerBind
// composed it.)
// BET  moved OUT with its P8 authoring surface (CreateBetFeedForm plus
// the place-bet flow and the oracle console), in lockstep with the manifest's
// walletForm flag.
//
// The list is EMPTY today, and that is a valid state rather than a leftover:
// every user-encodable action currently has a form. It stays because the two
// contracts above must not re-conflate, and the next protocol-accepted-but
// -formless action belongs here rather than in COMMON_ACTIONS. The conformance
// guard pins it either way, comparing this list against the manifest's
// userEncodable-without-walletForm slice.
export const PROTOCOL_ONLY_ACTIONS = /** @type {const} */ ([]);

export const BITCOIN_ACTIONS = [...COMMON_ACTIONS, ...BTC_EXCLUSIVE_ACTIONS, ...PROTOCOL_ONLY_ACTIONS]
    .slice()
    .sort();
export const LITECOIN_ACTIONS = [...COMMON_ACTIONS, ...PROTOCOL_ONLY_ACTIONS].slice().sort();
export const DOGECOIN_ACTIONS = [...COMMON_ACTIONS, ...PROTOCOL_ONLY_ACTIONS].slice().sort();
