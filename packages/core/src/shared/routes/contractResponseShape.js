// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

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
