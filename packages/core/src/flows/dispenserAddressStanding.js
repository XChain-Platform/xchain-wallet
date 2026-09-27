// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Whether SOURCE may open a dispenser on a GET_ADDRESS it does not control.
//
// The DISPENSER rules (protocol/actions/dispenser.md, Rules) accept a create
// whose GET_ADDRESS differs from SOURCE only when one of these holds:
//   (a) GET_ADDRESS set DISPENSER_PREFERENCE 2 ("anyone may open here"),
//   (b) GET_ADDRESS has never appeared on chain (the fresh-address exception),
//   (c) SOURCE opened a valid dispenser there before (origin standing).
// A create that meets none of them is invalid, still costs the fee, and
// confers nothing, so the form asks before it lets the user pay for one.
//
// The host's confirm-screen preflight dry-runs the whole action and is the
// final word; this verdict exists so the user learns the answer while still
// on the form, from reads the wallet already makes.

export const OWNER_ONLY_REFUSAL = 'This address only lets its owner open dispensers.';

/**
 * @typedef {object} DispenserAddressStanding
 * @property {number | null} preference  effective DISPENSER_PREFERENCE, null when unread
 * @property {boolean | null} seen       any on-chain trace of the address, null when unknown
 * @property {boolean | null} origin     SOURCE opened a valid dispenser there, null when unread
 */

/**
 * @typedef {object} DispenserAddressVerdict
 * @property {'self' | 'preference' | 'fresh' | 'origin' | 'refused' | 'unknown'} kind
 * @property {boolean} allowed   false only for a confirmed refusal
 * @property {string} message    plain-language line for the form
 */

/**
 * Fold the three reads into one verdict, in the order the indexer checks them.
 *
 * @param {{ address: string, source: string } & DispenserAddressStanding} args
 * @returns {DispenserAddressVerdict | null} null when there is no address to judge
 */
export function dispenserAddressVerdict({ address, source, preference, seen, origin }) {
    const target = String(address || '').trim();
    if (!target) return null;
    // Opening on SOURCE itself is always allowed; nothing else is consulted.
    if (source && target === String(source).trim()) {
        return { kind: 'self', allowed: true, message: 'This is the source address itself, so it can always host its own dispenser.' };
    }
    // Rule (a): the address opted in to hosting anyone's dispenser.
    if (preference === 2) {
        return { kind: 'preference', allowed: true, message: 'Allowed: this address lets anyone open a dispenser on it.' };
    }
    // Rule (b): an address with no history can be claimed by the first opener.
    if (seen === false) {
        return { kind: 'fresh', allowed: true, message: 'Allowed: this address has no on-chain history, so anyone may open the first dispenser on it.' };
    }
    // Rule (c): the source opened a dispenser here before.
    if (origin === true) {
        return { kind: 'origin', allowed: true, message: 'Allowed: your source address opened a dispenser here before, so it may open another.' };
    }
    // Refuse only when every rule was read and each one failed.
    if (preference !== null && preference !== undefined && seen === true && origin === false) {
        return { kind: 'refused', allowed: false, message: OWNER_ONLY_REFUSAL };
    }
    return {
        kind: 'unknown',
        allowed: true,
        message: 'Could not confirm this address accepts your dispenser; the network will decide. If it refuses, the network fee is lost.',
    };
}

function rowsOf(resp) {
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp?.data)) return resp.data;
    if (Array.isArray(resp?.rows)) return resp.rows;
    return null;
}

// Call a messaging method when the host has it; null on absence or failure,
// so one unreadable source degrades its own rule to unknown and no further.
function tryCall(messaging, name, req) {
    if (typeof messaging?.[name] !== 'function') return Promise.resolve(null);
    return Promise.resolve()
        .then(() => messaging[name](req))
        .then((v) => (v === undefined ? null : v))
        .catch(() => null);
}

/**
 * Read the three facts the verdict needs, through the host's existing reads:
 * the ADDRESS-preference fold, the dispensers touching the address, and the
 * address's action history.
 *
 * @param {{ messaging: any, chainId: string, address: string, source: string }} args
 * @returns {Promise<DispenserAddressStanding>}
 */
export async function readDispenserAddressStanding({ messaging, chainId, address, source }) {
    const req = { chainId, address };
    const [prefs, dispensersResp, historyResp] = await Promise.all([
        tryCall(messaging, 'getAddressPreferences', req),
        tryCall(messaging, 'getDispensersForAddress', req),
        tryCall(messaging, 'getAddressHistory', req),
    ]);

    const prefNum = prefs ? Number(prefs.dispenserPreference) : NaN;
    const preference = Number.isFinite(prefNum) ? prefNum : null;

    const dispenserRows = rowsOf(dispensersResp);
    const historyRows = rowsOf(historyResp);

    // Origin standing needs a VALID create by this source with this address
    // as its dispenser address; an invalid attempt confers nothing.
    const origin = dispenserRows === null ? null : dispenserRows.some((r) => (
        String(r?.address || '') === address
        && String(r?.source || '') === source
        && String(r?.status || '').toLowerCase() === 'valid'
    ));

    // Any trace in any read means the address is not fresh. Fresh is claimed
    // only when all three reads answered and none of them found it.
    const traced = (prefs && prefs.onChain === true)
        || (dispenserRows !== null && dispenserRows.length > 0)
        || (historyRows !== null && (historyRows.length > 0 || Number(historyResp?.total) > 0));
    let seen = null;
    if (traced) seen = true;
    else if (prefs && dispenserRows !== null && historyRows !== null) seen = false;

    return { preference, seen, origin };
}
