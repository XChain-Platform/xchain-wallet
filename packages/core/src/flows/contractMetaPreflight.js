// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Client-side refusal of a DEPLOY the chain is going to reject for having no
// contract identity.
//
// CONTRACT_META_REQUIRED makes `meta.name` and `meta.description` a consensus
// requirement of the deployed source. A contract exporting neither indexes
// `invalid`, and the deployer has still paid the miner fee and the protocol
// fee for it. The SDK can prove that statically - it walks the source for
// `module.exports = { meta: {...} }` (and `X.meta = {...}` for a function
// export) - so both wallet deploy lanes ask before they compose anything.
//
// FEATURE-DETECTED BY RESULT SHAPE, NEVER BY `typeof`. The wallet consumes the
// SDK as the published package, and the published build predates
// `getExportedMeta`; more to the point, the web dev-shell's SDK mock is a Proxy
// that answers EVERY `get*` property with a function, so `typeof
// sdk.contracts.getExportedMeta === 'function'` is true against a stub that
// returns nothing usable. The only honest question is what came back: a plain
// object whose `status` is one of the three the contract defines. Anything else
// means "this SDK cannot answer", and the deploy composes unguarded exactly as
// it does today.
//
// Only a PROVEN absence refuses. A computed meta (`name: 'Escrow ' +
// xchain.getBlockHeight()`) reads as `undecidable`, which the chain may well
// accept, so refusing it would block a legal deploy from the wallet.

/**
 * The consensus verdict string the indexer writes for a contract that exports
 * no meta. Frozen: it is the token the chain records, so the wallet quotes it
 * verbatim rather than inventing its own wording for the same refusal.
 */
export const CONTRACT_META_REQUIRED = 'invalid: CONTRACT_MANIFEST (meta required)';

/** The three answers `sdk.contracts.getExportedMeta` is defined to give. */
const META_STATUSES = new Set(['present', 'absent', 'undecidable']);

/**
 * One `getExportedMeta` answer if it IS one, else null.
 *
 * This is the whole feature detection, and it is deliberately a check on the
 * VALUE rather than on the method: a Proxy stub answers `typeof …get… ===
 * 'function'` and then returns another Proxy, which has no `status` string
 * among the three and so reads here as "cannot answer".
 *
 * Also used by the deploy form, which receives the same answer relayed through
 * the messaging layer and must apply the identical check to it.
 *
 * @param {any} result
 * @returns {{ status: 'present' | 'absent' | 'undecidable' } & Record<string, any> | null}
 */
export function normalizeMetaRead(result) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
    if (typeof result.status !== 'string' || !META_STATUSES.has(result.status)) return null;
    return result;
}

/**
 * The static meta read for one source, or null when the installed SDK cannot
 * answer it.
 *
 * Null covers every "cannot answer" case together - no `contracts` object, no
 * method, a method that threw, a stub that returned a Proxy or a string - so
 * callers have one condition to branch on instead of a list of ways to fail.
 *
 * @param {any} sdk   an SDK instance from the registry
 * @param {string} code   raw UTF-8 contract source
 * @returns {{ status: 'present' | 'absent' | 'undecidable', name?: string,
 *   description?: string, version?: string, computed?: string[],
 *   nonStringLiteral?: string[], line?: number } | null}
 */
export function readExportedMeta(sdk, code) {
    if (!sdk || typeof code !== 'string') return null;
    const contracts = sdk.contracts;
    if (!contracts) return null;
    let result;
    try {
        result = contracts.getExportedMeta(code);
    } catch {
        // An SDK that throws here is one that cannot answer, not one that
        // proved something: never turn a stub's TypeError into a refusal.
        return null;
    }
    return normalizeMetaRead(result);
}

/**
 * Refuse a deploy whose source PROVABLY exports no `meta`, before a
 * transaction is composed and therefore before any fee is spent.
 *
 * Returns the meta read (or null when the SDK predates the check) so the caller
 * can label the run with the contract's own name instead of asking the user for
 * one.
 *
 * @param {{ sdkRegistry: any, chainId: string, code: string }} args
 * @returns {ReturnType<typeof readExportedMeta>}
 * @throws {Error} with the consensus string when the meta is proven absent
 */
export function preflightContractMeta({ sdkRegistry, chainId, code }) {
    if (!sdkRegistry || !chainId) return null;
    let sdk;
    try {
        sdk = sdkRegistry.get(chainId);
    } catch {
        return null;
    }
    const meta = readExportedMeta(sdk, code);
    if (meta && meta.status === 'absent') {
        const err = new Error(CONTRACT_META_REQUIRED);
        // The caller's error surfaces read `code` to decide whether a failure is
        // the user's to fix; this one is, by editing the contract.
        err.code = 'CONTRACT_META_REQUIRED';
        throw err;
    }
    return meta;
}

/**
 * The name a `present` read carries, or null. Used to label a pending
 * transaction and a chunked-deploy record with the identity the chain will
 * record, rather than with a device-local guess.
 *
 * @param {ReturnType<typeof readExportedMeta>} meta
 * @returns {string | null}
 */
export function metaNameOf(meta) {
    if (!meta || meta.status !== 'present') return null;
    return typeof meta.name === 'string' && meta.name.trim() ? meta.name : null;
}
