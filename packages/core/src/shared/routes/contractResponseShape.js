// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { protocolCoinTickerFor } from '../../registry/nativeFee.js';
import { neutralizeControlText } from '../utils/textHardening.js';

// The explorer's single-record endpoints answer in a few historical shapes
// ({data: row}, {data: [row]}, [row], or the bare row). Normalize to the row
// so callers don't re-implement the unwrap. Shared by ContractDetail and
// ExecuteContractForm.
export function extractSingle(resp) {
    if (!resp) return null;
    if (resp.data && !Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.data) && resp.data.length > 0) return resp.data[0];
    if (Array.isArray(resp) && resp.length > 0) return resp[0];
    return resp;
}

// A contract's token custody, normalized to `[{tick, quantity}]` (D-23). The
// explorer answers getContractBalance in the same historical spread as every
// other list endpoint - a bare array, {data: [...]}, {balances: [...]}, or a
// plain {TICK: amount} map - and the WITHDRAW form has to reason about the
// amounts, not just print them, so the unwrap lives here rather than inside a
// render helper. Anything unrecognized normalizes to an empty list: showing no
// custody is safe, inventing some is not.
export function contractBalanceRows(balances) {
    if (!balances) return [];
    if (Array.isArray(balances)) return balances.map(normalizeContractBalance);
    if (Array.isArray(balances.data)) return balances.data.map(normalizeContractBalance);
    if (Array.isArray(balances.balances)) return balances.balances.map(normalizeContractBalance);
    if (typeof balances === 'object') {
        return Object.entries(balances)
            .filter(([k]) => k !== 'data' && k !== 'total')
            .map(([tick, quantity]) => ({ tick, quantity }));
    }
    return [];
}

function normalizeContractBalance(row) {
    return {
        tick: row.tick || row.TICK || row.ticker || '?',
        quantity: row.quantity ?? row.amount ?? row.AMOUNT ?? '?',
    };
}

/**
 * What the contract holds of one tick, as a decimal string, or null when the
 * custody is unknown (not loaded / unreadable) or the contract holds none.
 *
 * Null and '0' are deliberately distinct: null means "don't gate on this", '0'
 * means "the contract is empty", and a WITHDRAW form that conflates them either
 * blocks every withdrawal or none.
 */
export function contractBalanceOf(balances, tick) {
    if (!balances || !tick) return null;
    const want = String(tick).trim().toUpperCase();
    const row = contractBalanceRows(balances)
        .find((b) => String(b.tick).trim().toUpperCase() === want);
    if (!row) return null;
    const q = String(row.quantity);
    return q === '?' || q === '' || Number.isNaN(Number(q)) ? null : q;
}

// Defensive re-normalization of a contract's self-declared `abi` as served by
// the explorer. The abi is display metadata the deployer controls and the
// explorer relays verbatim, so a malformed or hostile shape must never reach
// render: a method whose `params` is a string (or any non-array) would throw on
// `.map` and, with no ErrorBoundary in the wallet, white-screen the whole SPA.
// Fail-closed per method, mirroring the SDK/explorer parseAbi: a method whose
// `params` is present but not an array is dropped, and a kept method is
// guaranteed a `params` array of {name,type}. Returns a safe {version, methods}
// or null when nothing usable remains (callers fall back to the manual lane).
export function sanitizeAbi(abi) {
    if (!abi || typeof abi !== 'object') return null;
    const rawMethods = abi.methods;
    if (!rawMethods || typeof rawMethods !== 'object') return null;
    const methods = {};
    for (const [name, spec] of Object.entries(rawMethods)) {
        if (!spec || typeof spec !== 'object') continue;
        let params = [];
        if (spec.params !== undefined && spec.params !== null) {
            if (!Array.isArray(spec.params)) continue;
            params = spec.params
                .filter((p) => p && typeof p === 'object')
                .map((p) => ({ name: String(p.name ?? ''), type: String(p.type ?? '') }));
        }
        const entry = { params };
        if (typeof spec.summary === 'string') entry.summary = spec.summary;
        if (typeof spec.view === 'boolean') entry.view = spec.view;
        methods[name] = entry;
    }
    if (Object.keys(methods).length === 0) return null;
    return { version: abi.version, methods };
}

// ---------------------------------------------------------------------------
// Contract identity (CONTRACT_META_REQUIRED)
//
// A contract's name, description and version are an export of its own source,
// extracted by the indexer and served by the explorer two ways: flat
// `meta_name` / `meta_description` / `meta_version` on a contract object and
// list row, and `contract_meta_name` / `contract_meta_version` on the DEPLOY,
// EXECUTE, DEPOSIT and WITHDRAW action payloads a history row is built from.
// `meta` carries the whole parsed object (or null), which is where a field that
// is not displayed yet lives.
//
// These are author-controlled strings relayed verbatim, so they are hardened at
// READ, not at each render site: a name carrying a bidi override or a run of
// C0 controls would otherwise reach a signing-adjacent screen raw. Caps mirror
// the consensus grammar (64 / 512 / 32) so a value the chain could never have
// stored cannot stretch a row either.
// ---------------------------------------------------------------------------

const META_NAME_MAX = 64;
const META_DESCRIPTION_MAX = 512;
const META_VERSION_MAX = 32;

/** One meta string as it may be rendered, or null when there is nothing usable. */
function metaText(value, maxLength) {
    if (typeof value !== 'string') return null;
    const clean = neutralizeControlText(value, { maxLength });
    return clean === '' ? null : clean;
}

/**
 * The contract identity carried by an explorer row, hardened and normalized.
 *
 * Reads the flat contract-object fields, the `contract_meta_*` prefixed fields
 * an action payload uses, and the nested parsed `meta` object, in that order,
 * so one helper serves the contract page, the list rows and a history row.
 * Every field is independently nullable: a contract deployed before the flag
 * day has none of them, and one deployed without a version has two of three.
 *
 * @param {any} row
 * @returns {{ name: string | null, description: string | null, version: string | null }}
 */
export function contractMetaOf(row) {
    if (!row || typeof row !== 'object') return { name: null, description: null, version: null };
    const nested = row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta) ? row.meta : null;
    return {
        name: metaText(row.meta_name ?? row.META_NAME ?? row.contract_meta_name
            ?? row.CONTRACT_META_NAME ?? (nested ? nested.name : null), META_NAME_MAX),
        description: metaText(row.meta_description ?? row.META_DESCRIPTION
            ?? (nested ? nested.description : null), META_DESCRIPTION_MAX),
        version: metaText(row.meta_version ?? row.META_VERSION ?? row.contract_meta_version
            ?? row.CONTRACT_META_VERSION ?? (nested ? nested.version : null), META_VERSION_MAX),
    };
}

/**
 * A contract's derived address, `C:<COIN>:<action_index>`.
 *
 * The chain segment is the BASE coin, not the network: a contract on Bitcoin
 * regtest prints `C:BTC:12`, because the indexer derives the address from
 * `config['CHAIN'] = coin`. Null for a chain the wallet has no PROTOCOL coin
 * for, or an unusable index, so a caller falls back to the number alone rather
 * than inventing an address (a user-added custom chain would otherwise get a
 * plausible-looking `C:NOPE:12` for a protocol that does not run there).
 *
 * @param {string | { coin?: string } | null | undefined} chainOrDescriptor
 * @param {string | number | null | undefined} actionIndex
 * @returns {string | null}
 */
export function contractAddressFor(chainOrDescriptor, actionIndex) {
    const ticker = protocolCoinTickerFor(chainOrDescriptor);
    if (!ticker) return null;
    const idx = actionIndex === null || actionIndex === undefined ? '' : String(actionIndex).trim();
    if (!idx) return null;
    return `C:${ticker}:${idx}`;
}

/**
 * How every wallet surface names one contract: the name and version the chain
 * recorded, followed by the address that is its actual identity.
 *
 *   "Escrow v1.0.0 (C:BTC:12)"    name and version
 *   "Escrow (C:BTC:12)"           no version exported
 *   "Unnamed contract (C:BTC:12)" deployed before the flag day
 *   "Unnamed contract #12"        chain with no protocol coin, or no address
 *
 * The address is never dropped: names are not unique and never will be, so a
 * surface that printed the name alone would let two contracts look like one.
 *
 * @param {any} row   an explorer contract row, list row or action payload
 * @param {{ chainId?: string, actionIndex?: string | number | null }} ctx
 * @returns {string}
 */
export function contractDisplayLabel(row, { chainId, actionIndex } = {}) {
    const { name, version } = contractMetaOf(row);
    const idx = actionIndex ?? (row && (row.action_index ?? row.contract_action_index
        ?? row.ACTION_INDEX ?? row.CONTRACT_ACTION_INDEX));
    const address = contractAddressFor(chainId, idx);
    const identity = address || (idx === null || idx === undefined || String(idx) === ''
        ? '' : `#${idx}`);
    const label = name ? `${name}${version ? ` v${version}` : ''}` : 'Unnamed contract';
    if (!identity) return label;
    return address ? `${label} (${address})` : `${label} ${identity}`;
}
