// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// stakingQueries: thin read-only wrappers over the staking-side
// explorer passthroughs landed in xchain-sdk 1.10.0
// (ExplorerClient.getStakes / getDelegations / getValidators /
// getValidatorRewards). Back the §42.7.4 Staking dashboard and the
// §42.7.5 Operator dashboard.
//
// Staking is BTC-only at launch per §10.3; callers should already
// have resolved a BTC chain via useBtcAddressesPresent before
// invoking these. Each flow delegates to an sdkRegistry-scoped SDK.

// The explorer answers a list with one page of at most 100 rows plus the
// `total` it found. Every sum the staking screens show (staked, accrued,
// claimed) is only right over ALL rows, so an address-scoped read follows the
// pages until `total` is covered. A caller that asks for a page or a limit
// itself is paging on purpose and gets exactly that page.
const MAX_PAGES = 200;
const PAGE_CONCURRENCY = 4;

/**
 * @param {(opts?: object) => Promise<any>} read  one explorer list read
 * @param {object} [opts]
 * @returns {Promise<any>}  the first response with `data` holding every row
 */
export async function readAllPages(read, opts) {
    const first = await read(opts);
    if (opts && (opts.page !== undefined || opts.limit !== undefined)) return first;
    if (!first || Array.isArray(first) || !Array.isArray(first.data)) return first;
    const total = Number(first.total);
    const pageSize = first.data.length;
    if (!Number.isFinite(total) || pageSize === 0 || pageSize >= total) return first;
    const pages = Math.ceil(total / pageSize);
    if (pages > MAX_PAGES) {
        throw new Error(`This address has ${total} rows, more than the wallet can read at once.`);
    }
    const rows = [...first.data];
    for (let start = 2; start <= pages; start += PAGE_CONCURRENCY) {
        const batch = [];
        for (let page = start; page < start + PAGE_CONCURRENCY && page <= pages; page += 1) {
            batch.push(read({ ...opts, page }));
        }
        for (const response of await Promise.all(batch)) {
            if (!response || !Array.isArray(response.data)) {
                throw new Error(`The explorer sent an unreadable page of ${total} rows.`);
            }
            rows.push(...response.data);
        }
    }
    // A short page (rows that shift out between page reads) would cut every
    // sum without a sign; a repeated row is fine, since the sums count a
    // ledger row once per identity.
    if (rows.length < total) {
        throw new Error(`The explorer sent ${rows.length} of ${total} rows, so the totals cannot be read yet.`);
    }
    return { ...first, data: rows };
}

/**
 * @typedef {Object} StakingQueryOpts
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {string} [address]    source / holder address for per-address queries
 * @property {object} [opts]       pagination forwarded to the SDK
 */

/**
 * List stake entries keyed to an address (either deposits the address
 * made, or the validator's own stake). Backs "Your stake" + the
 * operator's stake status.
 *
 * @param {StakingQueryOpts} params
 */
export async function stakesForAddress({ sdkRegistry, chainId, address, opts }) {
    if (!sdkRegistry) throw new Error('stakesForAddress: sdkRegistry is required');
    if (!chainId) throw new Error('stakesForAddress: chainId is required');
    if (!address) throw new Error('stakesForAddress: address is required');
    const sdk = sdkRegistry.get(chainId);
    return readAllPages((o) => sdk.getStakes(address, 'address', o), opts);
}

/**
 * List DELEGATE records scoped to an address. Backs the dashboard's
 * "Delegated pubkey" line and the operator dashboard's delegation
 * chain.
 *
 * @param {StakingQueryOpts} params
 */
export async function delegationsForAddress({ sdkRegistry, chainId, address, opts }) {
    if (!sdkRegistry) throw new Error('delegationsForAddress: sdkRegistry is required');
    if (!chainId) throw new Error('delegationsForAddress: chainId is required');
    if (!address) throw new Error('delegationsForAddress: address is required');
    const sdk = sdkRegistry.get(chainId);
    return readAllPages((o) => sdk.getDelegations(address, 'address', o), opts);
}

/**
 * List reward events scoped to an address (pending + historical). Backs
 * the "Pending rewards" / "Lifetime rewards" / "Recent reward events"
 * sections.
 *
 * @param {StakingQueryOpts} params
 */
export async function rewardsForAddress({ sdkRegistry, chainId, address, opts }) {
    if (!sdkRegistry) throw new Error('rewardsForAddress: sdkRegistry is required');
    if (!chainId) throw new Error('rewardsForAddress: chainId is required');
    if (!address) throw new Error('rewardsForAddress: address is required');
    const sdk = sdkRegistry.get(chainId);
    return readAllPages((o) => sdk.getValidatorRewards(address, 'address', o), opts);
}

/**
 * PC-47: the COLLECT events for an address (the reward_claims table), the
 * subtrahend in the unclaimed-rewards sum. Distinct from rewardsForAddress,
 * which lists the ACCRUAL ledger: accrued minus successfully-claimed is what a
 * validator can still claim, and only claims the chain marked valid count
 * (a claim the chain refused, e.g. an under-funded reward pool, leaves a row
 * behind but moved nothing). See flows/stakingDashboard.js.
 *
 * @param {StakingQueryOpts} params
 */
export async function rewardClaimsForAddress({ sdkRegistry, chainId, address, opts }) {
    if (!sdkRegistry) throw new Error('rewardClaimsForAddress: sdkRegistry is required');
    if (!chainId) throw new Error('rewardClaimsForAddress: chainId is required');
    if (!address) throw new Error('rewardClaimsForAddress: address is required');
    const sdk = sdkRegistry.get(chainId);
    return readAllPages((o) => sdk.getCollects(address, 'address', o), opts);
}

/**
 * List every validator on a chain. Backs the §42.7.5 Operator
 * dashboard's roster view.
 *
 * @param {{ sdkRegistry: any, chainId: string, opts?: object }} params
 */
export async function validatorsForChain({ sdkRegistry, chainId, opts }) {
    if (!sdkRegistry) throw new Error('validatorsForChain: sdkRegistry is required');
    if (!chainId) throw new Error('validatorsForChain: chainId is required');
    const sdk = sdkRegistry.get(chainId);
    return readAllPages((o) => sdk.getValidators(o), opts);
}

/**
 * Per-capability MIN_STAKE thresholds for capability staking, read live
 * from the hub. Returns an array of { capability, min_stake, disabled }
 * rows, or null when the hub is unreachable / not configured (e.g. regtest)
 * or the linked SDK predates the getter. Backs StakeForm's live "which
 * capabilities does this stake qualify for" readout. Capabilities are
 * global governance config; chainId only selects which SDK's hub to ask.
 *
 * @param {{ sdkRegistry: any, chainId: string }} params
 */
export async function capabilityThresholds({ sdkRegistry, chainId }) {
    if (!sdkRegistry) throw new Error('capabilityThresholds: sdkRegistry is required');
    if (!chainId) throw new Error('capabilityThresholds: chainId is required');
    const sdk = sdkRegistry.get(chainId);
    if (typeof sdk.getCapabilityThresholds !== 'function') return null;
    return sdk.getCapabilityThresholds();
}

/**
 * Contract-targeted staking queries, parallel to the capability staking ones above.
 * Backs the §42.7.x contract-stake rows in StakingList/StakeDetail.
 *
 * NOTE: These call sdk.getContractStakes / getContractUnstakes / getContractDelegations /
 * getSlashEvents. These methods need to be added to ExplorerClient in xchain-sdk + REST
 * endpoints exposed by xchain-explorer. Tracked as a Phase 7 follow-up alongside the
 * wallet UI work. Until the SDK methods land, these wrappers will throw at runtime.
 */

/**
 * List contract-targeted stakes keyed to an address.
 * @param {StakingQueryOpts} params
 */
export async function contractStakesForAddress({ sdkRegistry, chainId, address, opts }) {
    if (!sdkRegistry) throw new Error('contractStakesForAddress: sdkRegistry is required');
    if (!chainId) throw new Error('contractStakesForAddress: chainId is required');
    if (!address) throw new Error('contractStakesForAddress: address is required');
    const sdk = sdkRegistry.get(chainId);
    if (typeof sdk.getContractStakes !== 'function') {
        throw new Error('contractStakesForAddress: sdk.getContractStakes not yet available (Phase 7 follow-up)');
    }
    return readAllPages((o) => sdk.getContractStakes(address, 'address', o), opts);
}

/**
 * List active contract-targeted unstakes (positions in cooldown) for an address.
 * @param {StakingQueryOpts} params
 */
export async function contractUnstakesForAddress({ sdkRegistry, chainId, address, opts }) {
    if (!sdkRegistry) throw new Error('contractUnstakesForAddress: sdkRegistry is required');
    if (!chainId) throw new Error('contractUnstakesForAddress: chainId is required');
    if (!address) throw new Error('contractUnstakesForAddress: address is required');
    const sdk = sdkRegistry.get(chainId);
    if (typeof sdk.getContractUnstakes !== 'function') {
        throw new Error('contractUnstakesForAddress: sdk.getContractUnstakes not yet available (Phase 7 follow-up)');
    }
    return readAllPages((o) => sdk.getContractUnstakes(address, 'address', o), opts);
}

/**
 * List slash events affecting an address (either as the slashed staker, or as the
 * destination receiving slashed funds).
 * @param {StakingQueryOpts} params
 */
export async function slashEventsForAddress({ sdkRegistry, chainId, address, opts }) {
    if (!sdkRegistry) throw new Error('slashEventsForAddress: sdkRegistry is required');
    if (!chainId) throw new Error('slashEventsForAddress: chainId is required');
    if (!address) throw new Error('slashEventsForAddress: address is required');
    const sdk = sdkRegistry.get(chainId);
    if (typeof sdk.getSlashEvents !== 'function') {
        throw new Error('slashEventsForAddress: sdk.getSlashEvents not yet available (Phase 7 follow-up)');
    }
    return sdk.getSlashEvents(address, 'address', opts);
}
