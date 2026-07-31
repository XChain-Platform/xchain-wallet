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
    'DEPLOY',
    'DEPOSIT',
    'DESTROY',
    'DISPENSER',
    'DIVIDEND',
    'EXECUTE',
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
// DEPLOY and EXECUTE used to sit here too, and were the reason this list
// outlived the staking split. Not because the chain refused them: LTC/DOGE
// settle the protocol fee in NATIVE COIN, the indexer denylists a dry-run
// feequote for exactly these two (they run caller-supplied code in the VM, so
// dry-running them on a shared node would be a block-loop stall primitive),
// and the denylist advice - "pay the fee in XCHAIN" - has no LTC/DOGE
// equivalent. A wallet there could compose them and never pay for them.
//
// That gap is closed, in all four places it had to close :
//   - INDEXER:  gives DEPLOY/EXECUTE a schedule-priced, verdict-free
//     static quote, and the SDK reads its `valid:null` as payable-but-
//     unverified rather than as a refusal.
//   - WALLET forms:  put the useNativeFee/NativeFeeToggle lane on
//     DeployContractForm and ExecuteContractForm (mandatory wherever there is
//     no XCHAIN lane) and pointed the DEPLOY form chain list at THIS list.
//   - FEE PLACEMENT:  moved the fee output onto the phase-2 reveal (the
//     transaction the indexer checks) and  kept it declared to the
//     phase-1 build so the commit reserves its value; see flows/nativeFeeLane.
//   - VENUE: proven live rather than argued. A wallet-composed DEPLOY paying
//     the native fee indexes `valid` on litecoin-regtest (actions 1226-1228,
//     6946667 sats to FEE_DESTINATION) and on dogecoin-regtest (action 953,
//     20.84 DOGE), through both submitWithSigner branches, driven by
//     tools/regtest/deployNativeFee.mjs on 2026-07-28.
//
// So they are gone from this list and COLLECT is alone in it. Reverting that
// flip is a VENUE question, not a code one: re-run the driver on both chains
// before believing any claim that these are unpayable again.
//
// BATCH is NOT the same shape, contrary to a note this replaced. Measured
// 2026-07-26: batch.js runs every sub-action through processAction, so each
// one validates its OWN native fee and BATCH itself never calls
// validateNativeCoinFee and carries no protocol fee. Its denylisting is a
// QUOTING limit (a compound action cannot be priced without running the
// engine), not a payability one, so it correctly stays in COMMON_ACTIONS on
// every chain.
export const BTC_EXCLUSIVE_ACTIONS = /** @type {const} */ ([
    'COLLECT',
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
