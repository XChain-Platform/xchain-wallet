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
    // XBRIDGE is authorable on EVERY chain even though each user-broadcast
    // version is chain-restricted: v0 (lock XCHAIN) and v3 (lock a general
    // token) run on the asset's origin chain, v1 and v4 (burn back) run
    // everywhere else. These lists advertise what a chain's protocol accepts,
    // not which leg a given chain offers, so the action belongs in the common
    // set and BridgeMoveForm picks the version from the chain it is on.
    'XBRIDGE',
]);

// What stays Bitcoin-only, and why each one does.
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
// form level rather than here, through validatorLaneChainIds and
// assertValidatorLaneChain below.
//
// DEPLOY and EXECUTE stay out of this list. The case for listing them was
// never that the chain refused them: LTC/DOGE
// settle the protocol fee in NATIVE COIN, the indexer denylists a dry-run
// feequote for exactly these two (they run caller-supplied code in the VM, so
// dry-running them on a shared node would be a block-loop stall primitive),
// and the denylist advice - "pay the fee in XCHAIN" - has no LTC/DOGE
// equivalent. A wallet there could compose them and never pay for them.
//
// That gap is closed, in all four places it had to close:
// - INDEXER: a later change gives DEPLOY/EXECUTE a schedule-priced, verdict-free
//     static quote, and the SDK reads its `valid:null` as payable-but-
//     unverified rather than as a refusal.
// - WALLET forms: put the useNativeFee/NativeFeeToggle lane on
//     DeployContractForm and ExecuteContractForm (mandatory wherever there is
//     no XCHAIN lane) and pointed the DEPLOY form chain list at THIS list.
// - FEE PLACEMENT: a later change moved the fee output onto the phase-2 reveal (the
// transaction the indexer checks) and a later change kept it declared to the
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

// Name the one coin whose indexer accepts the validator-lane versions above.
export const VALIDATOR_LANE_COIN = 'bitcoin';

/**
 * Keep only the chains a validator-lane form may offer, so a user cannot
 * pick Litecoin or Dogecoin and pay a fee for an action refused there.
 *
 * @param {string[]} chainIds
 * @param {{ get(chainId: string): ({ coin?: string } | undefined) }} chainRegistry
 * @returns {string[]}
 */
export function validatorLaneChainIds(chainIds, chainRegistry) {
    return (chainIds || []).filter((id) => chainRegistry?.get?.(id)?.coin === VALIDATOR_LANE_COIN);
}

/**
 * Refuse a validator-lane composer aimed at a chain other than Bitcoin,
 * before anything is signed or broadcast.
 *
 * @param {{ get(chainId: string): ({ coin?: string } | undefined) }} chainRegistry
 * @param {string} chainId
 * @param {string} who  composer name for the error prefix
 */
export function assertValidatorLaneChain(chainRegistry, chainId, who) {
    if (chainRegistry?.get?.(chainId)?.coin !== VALIDATOR_LANE_COIN) {
        throw new Error(`${who}: validator staking actions are accepted on Bitcoin only, not on ${chainId}`);
    }
}

// Versions the indexer accepts on Bitcoin only, per the split above; `null`
// means every version. XBRIDGE v0 is the Bitcoin lock leg (bridgeLegFor).
const BITCOIN_ONLY_VERSIONS = /** @type {Record<string, number[] | null>} */ ({
    COLLECT: null,
    STAKE: [1, 2],
    UNSTAKE: [0],
    DELEGATE: [0, 2],
    XBRIDGE: [0],
});
// Versions the indexer refuses on Bitcoin: XBRIDGE v1 is the burn back to it.
const NOT_ON_BITCOIN_VERSIONS = /** @type {Record<string, number[]>} */ ({ XBRIDGE: [1] });

/** Actions whose acceptance depends on the chain, so a generic composer checks them. */
export const CHAIN_GATED_ACTIONS = Object.freeze(Object.keys(BITCOIN_ONLY_VERSIONS));

/**
 * Refuse an action version the indexer always rejects on this chain, before a
 * generic composer signs it and the user pays a fee for an invalid record.
 *
 * @param {{ get(chainId: string): ({ coin?: string } | undefined) }} chainRegistry
 * @param {string} chainId
 * @param {string} action
 * @param {number} version  the version the SDK resolves for the params
 * @param {string} who  composer name for the error prefix
 */
export function assertActionAllowedOnChain(chainRegistry, chainId, action, version, who) {
    const name = String(action || '').toUpperCase();
    const onBitcoin = chainRegistry?.get?.(chainId)?.coin === VALIDATOR_LANE_COIN;
    const btcOnly = BITCOIN_ONLY_VERSIONS[name];
    if (!onBitcoin && btcOnly !== undefined && (btcOnly === null || btcOnly.includes(version))) {
        throw new Error(`${who}: ${name} version ${version} is accepted on Bitcoin only, not on ${chainId}`);
    }
    if (onBitcoin && NOT_ON_BITCOIN_VERSIONS[name]?.includes(version)) {
        throw new Error(`${who}: ${name} version ${version} is not accepted on Bitcoin`);
    }
}

/**
 * Whether a composer picker should list `action` for this chain at all: false
 * only for an action refused there at every version (COLLECT off Bitcoin).
 *
 * @param {{ get(chainId: string): ({ coin?: string } | undefined) }} chainRegistry
 * @param {string} chainId
 * @param {string} action
 * @returns {boolean}
 */
export function isActionOfferedOnChain(chainRegistry, chainId, action) {
    const name = String(action || '').toUpperCase();
    if (BITCOIN_ONLY_VERSIONS[name] !== null) return true;
    return chainRegistry?.get?.(chainId)?.coin === VALIDATOR_LANE_COIN;
}

// Actions whose generic authoring belongs to the DEX surface, which a store
// build compiles out (web surfaces/registry.js); sell-name's ORDER is its own form.
export const DEX_ACTIONS = Object.freeze(['ORDER', 'SWAP']);

/**
 * Whether a generic composer picker should list `action` in this build: false
 * only for a DEX action when the build compiled the DEX surface out.
 *
 * @param {string} action
 * @param {{ hasDexSurface?: boolean }} [build]
 * @returns {boolean}
 */
export function isActionOfferedInBuild(action, { hasDexSurface = true } = {}) {
    if (hasDexSurface !== false) return true;
    return !DEX_ACTIONS.includes(String(action || '').trim().toUpperCase());
}

/**
 * Whether a composed action may be submitted in this build: false for a DEX
 * action, or a BATCH with a DEX leg, when the build compiled the DEX surface
 * out. Every string param of a BATCH is read as a COMMAND (legs split on ';',
 * leg name is the first '|' field, as the indexer splits them), so a key
 * spelling the composer did not expect still fails closed.
 *
 * @param {{ action?: string, params?: Record<string, unknown> }} actionData
 * @param {{ hasDexSurface?: boolean }} [build]
 * @returns {boolean}
 */
export function isActionDataOfferedInBuild({ action, params } = {}, build = {}) {
    if (!isActionOfferedInBuild(action, build)) return false;
    if (build.hasDexSurface !== false) return true;
    if (String(action || '').trim().toUpperCase() !== 'BATCH') return true;
    const texts = Object.values(params || {}).flat().filter((v) => typeof v === 'string');
    for (const text of texts) {
        for (const leg of text.split(';')) {
            // Skip any pasted BATCH|<version>| prefix so the real first leg is read.
            const fields = leg.split('|').map((f) => f.replace(/["'\s]/g, '').toUpperCase());
            while (fields[0] === 'BATCH') fields.splice(0, 2);
            if (DEX_ACTIONS.includes(fields[0])) return false;
        }
    }
    return true;
}

// Protocol-accepted on every chain, form-less by design (see header note 2).
// ADDRESS moved OUT of this list in PC-32: v0 preferences got a real form
// (AddressPreferencesForm) and v1 controller-bind already had one
// (ControllerBindForm), so it is authorable on every chain. (The old note
// claiming the messaging flows emit ADDRESS was wrong; only controllerBind
// composed it.)
// BET moved OUT with its P8 authoring surface (CreateBetFeedForm plus
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

// Offer the authorable union when a generic composer cannot ask the SDK for
// its action list, so the fallback can never fall behind this registry.
export const AUTHORABLE_ACTIONS = Object.freeze([...COMMON_ACTIONS, ...BTC_EXCLUSIVE_ACTIONS].slice().sort());
