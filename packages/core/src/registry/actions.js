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
    'DELEGATE',
    'DEPOSIT',
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
    'STAKE',
    'SWAP',
    'SWEEP',
    'UNSTAKE',
    'VOTE',
    'WITHDRAW',
]);

// What stays Bitcoin-only, and why each one does .
//
// Most of the contract family moved into COMMON_ACTIONS above, because
// `supportedActions` advertises WHAT THE CHAIN'S PROTOCOL ACCEPTS (see
// header note 2) and the indexer accepts all of it on LTC/DOGE today:
//
//   - DEPLOY / EXECUTE / DEPOSIT / WITHDRAW carry no coin gate at all.
//   - STAKE v3, UNSTAKE v1, DELEGATE v1/v3 (the CONTRACT-targeted
//     versions) dispatch to their own handlers BEFORE the `COIN !==
//     'BTC'` check, so they are already chain-open.
//   - STAKE v1/v2, UNSTAKE v0, DELEGATE v0/v2 (the CAPABILITY /
//     validator versions) hit that check and stay Bitcoin-only, which
//     is the intended end state.
//
// COLLECT is the exception with no version split: it has a single
// format that claims accrued VALIDATOR rewards out of the reward pool
// (indexer collect.js -> getActiveStakeBySource / getUnclaimedRewardTotal
// / createRewardClaim), contract stakes accrue nothing through it, and
// it is coin-gated unconditionally. So it is validator-lane by
// definition and belongs here.
//
// Because this split is per-VERSION for STAKE/UNSTAKE/DELEGATE and this
// list is per-ACTION, the validator-only SURFACES gate themselves at the
// form level rather than here; see StakingList / StakeForm.
//
// DEPLOY and EXECUTE are held back for a different reason, and NOT
// because the chain refuses them: LTC/DOGE settle the protocol fee in
// NATIVE COIN, and sizing that output needs a feequote the indexer
// DENYLISTS for exactly these two (they run caller-supplied code in the
// VM, so dry-running them on a shared node would be a block-loop stall
// primitive). The denylist's advice - "pay the fee in XCHAIN" - is BTC-
// era and has no LTC/DOGE equivalent, so a wallet there can compose
// them but can never pay for them: measured live 2026-07-26, a DEPLOY
// indexes `insufficient fee (native coin output required)` while
// quoteNativeFee answers `supported:false`. Advertising them would hand
// the user a form that burns a network fee on a guaranteed-invalid
// action. They open when that fee-quote gap closes (see the ledger).
//
//  closed the INDEXER half of that gap (FEE_QUOTE_STATIC gives
// DEPLOY/EXECUTE a schedule-priced, verdict-free quote), and the SDK
// already treats its `valid:null` as payable-but-unverified. These two
// stay here anyway, because two other legs are still open :
// the LTC/DOGE regtest indexers still run PRE- code (measured
// 2026-07-26 via feequote on both: `supported:false`, "native fee
// pre-flight not supported"), and DeployContractForm/ExecuteContractForm
// have no native-fee lane at all - they are the only fee-bearing forms
// with no useNativeFee/NativeFeeToggle, because BTC could always settle
// in XCHAIN. Flipping this list before BOTH land would ship the exact
// hazard it was created to prevent.
//
// BATCH is NOT the same shape, contrary to the note this replaces.
// Measured 2026-07-26: batch.js runs every sub-action through
// processAction, so each one validates its OWN native fee and BATCH
// itself never calls validateNativeCoinFee and carries no protocol fee.
// Its denylisting is a QUOTING limit (a compound action can't be priced
// without running the engine), not a payability one, so it correctly
// stays in COMMON_ACTIONS on every chain.
export const BTC_EXCLUSIVE_ACTIONS = /** @type {const} */ ([
    'COLLECT',
    'DEPLOY',
    'EXECUTE',
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
