// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// useDispenserDestination: a coin-paid dispenser sells on a bare payment to
// its address, so a Send there is a purchase that no XChain action names. A
// payment the dispenser refuses (its oracle has no live price, or its lists
// bar the payer) keeps the coin and dispenses nothing, so Send says so first.

import { useEffect, useRef, useState } from 'react';
import { dispenserLiveState } from '../../flows/dispenserQueries.js';
import {
    buyerListVerdict,
    dispenserRefusesEveryoneMessage,
    listMembers,
    ownerOffAllowList,
} from '../../flows/allowListSelfCheck.js';
import { multiplyAmounts } from '../../market/orderMath.js';
import { neutralizeControlText } from '../utils/textHardening.js';

/**
 * The open coin-paid dispensers a native payment to `to` would trigger, each
 * with what its refusal checks need. Empty while unknown or when none match;
 * a failed lookup is silent so it never blocks or clutters an ordinary send.
 *
 * @param {{ messaging: any, chainId: string | null | undefined, to: string, enabled: boolean }} params
 * @returns {DispenserAtDestination[]}
 */
export function useDispenserDestination({ messaging, chainId, to, enabled }) {
    const [found, setFound] = useState(/** @type {DispenserAtDestination[]} */ ([]));
    const seqRef = useRef(0);
    useEffect(() => {
        // Bumped before any early return so a read still in flight for an
        // earlier destination can never land on this one.
        const seq = seqRef.current + 1;
        seqRef.current = seq;
        setFound([]);
        const dest = typeof to === 'string' ? to.trim() : '';
        if (!enabled || !chainId || !dest) return undefined;
        if (typeof messaging?.getDispensersForAddress !== 'function') return undefined;
        // Debounced: the destination changes per keystroke when typed by hand.
        const timer = setTimeout(() => {
            loadDispensersAt(messaging, chainId, dest)
                .then((rows) => { if (seqRef.current === seq) setFound(rows); })
                .catch(() => { /* best-effort, see above */ });
        }, 400);
        return () => { clearTimeout(timer); };
    }, [messaging, chainId, to, enabled]);
    return found;
}

/**
 * @typedef {object} DispenserAtDestination
 * @property {any} row                    list row merged over the by-index detail
 * @property {string[] | null} allowMembers
 * @property {string[] | null} blockMembers
 * @property {'live' | 'dark' | null} oracle  null when not oracle-priced or unreadable
 */

async function loadDispensersAt(messaging, chainId, dest) {
    const resp = await messaging.getDispensersForAddress({ chainId, address: dest });
    const rows = Array.isArray(resp) ? resp : (Array.isArray(resp?.data) ? resp.data : []);
    // Pay-to is GET_ADDRESS when set, otherwise SOURCE (the rule the detail
    // page uses). A token-priced dispenser (GET_TICK set) sells only for that
    // token, never for a native-coin payment.
    const open = rows.filter((r) => r && !r.get_tick
        && String(r.address || r.source || '').trim() === dest
        && dispenserLiveState(r).status === 'open');
    open.sort((a, b) => Number(a.action_index || 0) - Number(b.action_index || 0));
    return Promise.all(open.map((r) => assessDispenser(messaging, chainId, r)));
}

// Calls a messaging method when the host has it, resolving null on absence
// or failure, so each check degrades to "unknown" instead of throwing.
function tryCall(messaging, name, req) {
    if (typeof messaging?.[name] !== 'function') return Promise.resolve(null);
    return Promise.resolve(messaging[name](req)).catch(() => null);
}

async function assessDispenser(messaging, chainId, row) {
    // The list lane carries no allow/block lists and no FIAT_CODE; the
    // by-index read does, with the post-edit lists in its `state` block.
    const resp = await tryCall(messaging, 'getDispenserByActionIndex', {
        chainId, actionIndex: String(row.action_index),
    });
    const detail = resp?.dispenser || resp?.data?.dispenser || (resp?.give_tick ? resp : null);
    const merged = { ...(detail || {}), ...row, state: detail?.state ?? row.state };
    merged.fiat_code = merged.fiat_code || merged.fiat || '';
    const live = dispenserLiveState(merged);
    const readList = (idx) => (idx
        ? tryCall(messaging, 'getListByActionIndex', { chainId, actionIndex: String(idx) })
            .then((d) => (d ? listMembers(d) : null))
        : Promise.resolve(null));
    // Only Mode B (oracle, no fixed FIAT_AMOUNT) reads a quote at settlement.
    const oracleAddress = merged.oracle_address;
    const readsOracle = Boolean(oracleAddress) && merged.fiat_amount == null;
    const [allowMembers, blockMembers, feeds] = await Promise.all([
        readList(live.allowList),
        readList(live.blockList),
        readsOracle ? tryCall(messaging, 'oracleFeeds', { chainId, address: oracleAddress }) : null,
    ]);
    return { row: merged, allowMembers, blockMembers, oracle: oracleState(merged, feeds, readsOracle) };
}

// Settlement prices a Mode B fill from the live feed matching its own tick
// and fiat; with no such feed the dispense is refused ("no matching oracle
// price"). A maturing (pending) quote prices nothing yet, so only `live` counts.
function oracleState(row, feeds, readsOracle) {
    if (!readsOracle || !Array.isArray(feeds)) return null;
    const tick = String(row.give_tick || '').toUpperCase();
    const fiat = String(row.fiat_code || '').toUpperCase();
    const match = feeds.find((f) => f
        && String(f.tick || '').toUpperCase() === tick
        && (!fiat || String(f.fiat || '').toUpperCase() === fiat));
    return match?.live?.value ? 'live' : 'dark';
}

// floor(a / b) for plain decimal strings, exact at any scale (float division
// misfloors ordinary amounts). Null when either side is not a plain decimal
// or b is zero.
function floorDivide(a, b) {
    const pa = /^(\d*)(?:\.(\d*))?$/.exec(String(a ?? '').trim());
    const pb = /^(\d*)(?:\.(\d*))?$/.exec(String(b ?? '').trim());
    if (!pa || !pb || !/\d/.test(pa[0]) || !/\d/.test(pb[0])) return null;
    const scale = Math.max((pa[2] || '').length, (pb[2] || '').length);
    const ia = BigInt((pa[1] || '0') + (pa[2] || '').padEnd(scale, '0'));
    const ib = BigInt((pb[1] || '0') + (pb[2] || '').padEnd(scale, '0'));
    return ib > 0n ? ia / ib : null;
}

function safeText(v) {
    return neutralizeControlText(String(v ?? ''), { maxLength: 32 });
}

// What `amount` of coin buys from one fixed-price dispenser: whole fills at
// GET_AMOUNT each, capped at what its escrow still holds. The indexer keeps
// any overpayment, so a capped purchase says the rest is not refunded.
function receiveText(d, amount) {
    const row = d.row;
    const tick = safeText(row.give_tick || '?');
    if (!(Number(row.get_amount) > 0)) {
        const fiat = safeText(row.fiat_code || 'fiat');
        return `it is priced in ${fiat}, so what you would receive is fixed only when the payment lands`;
    }
    const byPayment = floorDivide(amount, row.get_amount);
    if (byPayment == null) return 'enter an amount to see what it would buy';
    if (byPayment <= 0n) {
        return `this amount is below its price of ${safeText(row.get_amount)} ${safeText(row.get_coin)} a fill `
            + 'and would buy nothing';
    }
    if (row.give_ownership) return `you would receive ownership of ${tick}`;
    const remaining = dispenserLiveState(row).giveRemaining;
    const byEscrow = remaining != null ? floorDivide(remaining, row.give_amount) : null;
    const fills = byEscrow != null && byEscrow < byPayment ? byEscrow : byPayment;
    const qty = multiplyAmounts(String(row.give_amount || ''), fills.toString()) ?? '?';
    return fills < byPayment
        ? `you would receive ${qty} ${tick}, all it has left; the rest of this payment is not refunded`
        : `you would receive ${qty} ${tick}`;
}

function refusalWarnings(d, payer) {
    const out = [];
    const payTo = String(d.row.address || d.row.source || '').trim();
    // The network checks the dispenser's own pay-to address against its
    // allow list as well as the buyer, so an owner-barred one sells to nobody.
    if (ownerOffAllowList({ members: d.allowMembers, getAddress: payTo })) {
        out.push(dispenserRefusesEveryoneMessage());
    } else if (payer && buyerListVerdict({
        addresses: [payer], allowMembers: d.allowMembers, blockMembers: d.blockMembers,
    }).verdict === 'refused') {
        out.push('The address you are sending from is not allowed to buy from this dispenser by its '
            + 'allow or block list. This payment would be refused and the coin is not returned.');
    }
    if (d.oracle === 'dark') {
        out.push('This dispenser\'s oracle has no current price. A payment made now is refused and '
            + 'the coin is not returned.');
    }
    return out;
}

/**
 * The review-screen copy for a Send whose destination runs open dispensers,
 * or null when it runs none.
 *
 * @param {{ dispensers: DispenserAtDestination[], payer?: string | null, amount: string }} params
 * @returns {{ summary: string, warnings: string[] } | null}
 */
export function dispenserDestinationNotice({ dispensers, payer, amount }) {
    if (!Array.isArray(dispensers) || dispensers.length === 0) return null;
    const ids = dispensers.map((d) => `#${safeText(d.row.action_index)}`);
    if (dispensers.length === 1) {
        return {
            summary: `This pays dispenser ${ids[0]}: ${receiveText(dispensers[0], amount)}.`,
            warnings: refusalWarnings(dispensers[0], payer),
        };
    }
    // One payment can fill several dispensers behind the same address, and
    // how it splits is settled by the indexer, so no estimate is given.
    return {
        summary: `This pays the ${dispensers.length} open dispensers at this address (${ids.join(', ')}). `
            + 'One payment can fill more than one of them, so the wallet does not estimate what you would receive.',
        warnings: dispensers.flatMap((d, i) => refusalWarnings(d, payer).map((w) => `Dispenser ${ids[i]}: ${w}`)),
    };
}
