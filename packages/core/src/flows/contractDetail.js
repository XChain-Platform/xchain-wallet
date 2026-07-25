// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// contractDetail: single-contract read flows for the §42.3 detail
// page. Each wraps one SDK method on an sdkRegistry-scoped instance,
// guards its required inputs, and returns the raw response shape for
// the component to render.
//
// The SDK currently exposes:
//   sdk.getContract(contractActionIndex)      contract metadata
//   sdk.getContractState(idx, key?)           key/value state
//   sdk.getContractBalance(idx, tick?)        per-token balances
//   sdk.getExecutions(contractActionIndex, 'contract', opts?)
//                                             paginated call history
//
// The detail page also needs the underlying DEPLOY action (for NAME,
// CODE_HASH, GAS_LIMIT, CONSTRUCTOR_PARAMS that don't live on the
// "contracts" table). We reuse the existing listQueries.actionByTxid
// wrapper's sibling method `sdk.getAction(actionIndex)` through a new
// `actionByIndex` flow here, because it's Contracts-specific scope.

/**
 * @typedef {Object} ContractRefOpts
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {string} contractActionIndex
 */

/**
 * Fetch contract metadata (owner, deploy block, gas limit, status,
 * code hash) for the §42.3 header block. Uses sdk.getContract which
 * hits /{COIN}/api/contract/{QUERY}.
 */
export async function contractByActionIndex({ sdkRegistry, chainId, contractActionIndex }) {
    if (!sdkRegistry) throw new Error('contractByActionIndex: sdkRegistry is required');
    if (!chainId) throw new Error('contractByActionIndex: chainId is required');
    if (!contractActionIndex) throw new Error('contractByActionIndex: contractActionIndex is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getContract(contractActionIndex);
}

/**
 * Fetch the originating DEPLOY action, which carries the NAME / CODE_HASH /
 * CONSTRUCTOR_PARAMS fields that aren't on the contract row. Reuses
 * sdk.getAction which takes a generic action_index.
 */
export async function actionByIndex({ sdkRegistry, chainId, actionIndex }) {
    if (!sdkRegistry) throw new Error('actionByIndex: sdkRegistry is required');
    if (!chainId) throw new Error('actionByIndex: chainId is required');
    if (!actionIndex) throw new Error('actionByIndex: actionIndex is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getAction(actionIndex);
}

/**
 * Fetch expandable state keys + values. With no `key` arg, returns the
 * full state map at the latest block. Backs the "State (expandable)"
 * section.
 *
 * @param {ContractRefOpts & { key?: string }} params
 */
export async function contractState({ sdkRegistry, chainId, contractActionIndex, key }) {
    if (!sdkRegistry) throw new Error('contractState: sdkRegistry is required');
    if (!chainId) throw new Error('contractState: chainId is required');
    if (!contractActionIndex) throw new Error('contractState: contractActionIndex is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getContractState(contractActionIndex, key);
}

/**
 * Fetch token balances held by the contract. With no `tick` arg,
 * returns every tick the contract holds (plus native-coin balance).
 *
 * @param {ContractRefOpts & { tick?: string }} params
 */
export async function contractBalance({ sdkRegistry, chainId, contractActionIndex, tick }) {
    if (!sdkRegistry) throw new Error('contractBalance: sdkRegistry is required');
    if (!chainId) throw new Error('contractBalance: chainId is required');
    if (!contractActionIndex) throw new Error('contractBalance: contractActionIndex is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getContractBalance(contractActionIndex, tick);
}

/**
 * Paginated list of EXECUTE calls against this contract. Backs the
 * "Execution history" section.
 *
 * @param {ContractRefOpts & { opts?: object }} params
 */
export async function executionsForContract({ sdkRegistry, chainId, contractActionIndex, opts }) {
    if (!sdkRegistry) throw new Error('executionsForContract: sdkRegistry is required');
    if (!chainId) throw new Error('executionsForContract: chainId is required');
    if (!contractActionIndex) throw new Error('executionsForContract: contractActionIndex is required');
    const sdk = sdkRegistry.get(chainId);
    // getExecutions is (query, type, opts): the explorer route is
    // /executions/{QUERY}/{TYPE} and the type segment is REQUIRED, so it must be
    // passed explicitly. Listing a contract's calls by its action index is
    // type 'contract'. Passing `opts` in the type slot (the old 2-arg
    // assumption) sent "[object Object]" as the type and 404'd every load.
    return sdk.getExecutions(contractActionIndex, 'contract', opts);
}

/**
 * @typedef {Object} ContractManifest
 * @property {string[] | null} permissions  action types the contract may emit; null = unrestricted/undeclared
 * @property {number | null}   maxTakeBps    max fee the contract may take, in basis points; null = undeclared
 */

const NULL_MANIFEST = /** @type {ContractManifest} */ ({ permissions: null, maxTakeBps: null });

/**
 * Phase F: read a contract's permissions manifest for the inline
 * consent disclosure shown before EXECUTE / DEPOSIT / WITHDRAW.
 *
 * Defensive by design: this flow **never throws**. It returns the
 * normalized `{ permissions, maxTakeBps }` shape the SDK reader
 * produces, and degrades to `{ permissions: null, maxTakeBps: null }`
 * on ANY gap: a missing chainId/contractActionIndex, an SDK instance
 * that predates `getContractManifest` (the SDK reader ships in
 * parallel under Phase F Part 2), or a network/parse error. A consent
 * panel must always render; an undeclared manifest is a soft caution,
 * not a hard failure.
 *
 * @param {ContractRefOpts} params
 * @returns {Promise<ContractManifest>}
 */
export async function contractManifestFor({ sdkRegistry, chainId, contractActionIndex }) {
    if (!sdkRegistry || !chainId || !contractActionIndex) return NULL_MANIFEST;
    let sdk;
    try {
        sdk = sdkRegistry.get(chainId);
    } catch {
        return NULL_MANIFEST;
    }
    if (!sdk || typeof sdk.getContractManifest !== 'function') return NULL_MANIFEST;
    try {
        const res = await sdk.getContractManifest(contractActionIndex);
        if (!res || typeof res !== 'object') return NULL_MANIFEST;
        return {
            permissions: Array.isArray(res.permissions) ? res.permissions : null,
            maxTakeBps: Number.isFinite(res.maxTakeBps) ? res.maxTakeBps : null,
        };
    } catch {
        return NULL_MANIFEST;
    }
}
