// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { registry as registryLib } from '@xchain-wallet/core';
import '../../i18n/locales/en/pending.js';
import { tickerForDescriptor } from '../../registry/coinTicker.js';
import { pendingDisplayState } from '../utils/pendingHistory.js';
import { formatLocalDateTime } from '../utils/dateTime.js';

export const OFFLINE_ACTION_REASON = 'This action needs a network connection.';

export const chainRegistry = registryLib.defaultRegistry();

export const NATIVE_TICKER_BY_COIN = (descriptor) => tickerForDescriptor(descriptor);

/**
 * M2.3: one copy table for every pending state, read by the row badge
 * and by the detail panel that row opens. Two tables would eventually
 * disagree, and a row reading "pending" above a panel saying the network
 * never saw the transaction teaches the user to believe neither.
 *
 * `pendingDisplayState` decides which entry applies; nothing here reads
 * the raw fields itself.
 */
export const PENDING_COPY = {
    'awaiting-network': {
        row: 'pending.row.awaitingNetwork',
        headline: 'pending.detail.awaitingNetwork',
        help: 'pending.detail.awaitingNetworkHelp',
    },
    seen: {
        row: 'pending.row.seen',
        headline: 'pending.detail.seen',
        help: 'pending.detail.seenHelp',
    },
    'not-seen': {
        row: 'pending.row.notSeen',
        headline: 'pending.detail.notSeen',
        help: 'pending.detail.notSeenHelp',
    },
    dropped: {
        row: 'pending.row.dropped',
        headline: 'pending.detail.dropped',
        help: 'pending.detail.droppedHelp',
    },
    replaced: {
        row: 'pending.row.replaced',
        headline: 'pending.detail.replaced',
        help: 'pending.detail.replacedHelp',
    },
    // Another transaction, not one this wallet made, spent the same coins.
    'replaced-elsewhere': {
        row: 'pending.row.replaced',
        headline: 'pending.detail.replacedElsewhere',
        help: 'pending.detail.replacedElsewhereHelp',
    },
    // The block is proven and no explorer row will ever take the entry's
    // place. The headline says what the block settled: a plain coin transfer
    // has no action to speak of, an action-carrying transaction the service
    // recorded nothing for had no effect beyond the coins it moved. Which
    // one applies is `confirmedCopyFor`'s call, from the entry's own tick.
    confirmed: {
        row: 'pending.row.confirmed',
        headline: 'pending.detail.confirmed',
        help: 'pending.detail.confirmedHelp',
    },
    // The wallet gave up before the network took the send (compose, sign or
    // broadcast threw). The only record of it is the wallet's own, so the
    // row is the one place the user can learn the send never happened.
    failed: {
        row: 'pending.row.failed',
        headline: 'pending.detail.failed',
        help: 'pending.detail.failedHelp',
    },
};

/** The `confirmed` copy for a transaction that carried an action the service did not record. */
export const CONFIRMED_NO_EFFECT_COPY = {
    row: 'pending.row.confirmed',
    headline: 'pending.detail.confirmedNoEffect',
    help: 'pending.detail.confirmedNoEffectHelp',
};

/**
 * The states where something has gone wrong enough that the user should
 * pick the row out of a list without reading it (M2 acceptance test 3).
 * Healthy pending and "nothing has ever reported this" must not look
 * alike.
 */
export const PENDING_WARNING_STATES = new Set(['not-seen', 'dropped', 'replaced-elsewhere', 'failed']);

/**
 * The pending state of an entry, or null when there is nothing to
 * describe. A blockless row carrying no pending metadata (an older
 * shell, a synthesized demo row) gets no state rather than a guessed
 * one: every state is a claim about the network, and for those rows we
 * hold no evidence for any of them.
 *
 * @param {{ pending?: object } | null | undefined} entry
 */
export function pendingStateOf(entry) {
    return entry?.pending ? pendingDisplayState(entry, Date.now()) : null;
}

/**
 * Did this local record move the chain's own coin and nothing else? The
 * record's `tick` is the ticker the send moved; a plain transfer carries the
 * native one, an action-carrying transaction carries a token's or none.
 *
 * @param {{ chainId?: string, raw?: { tick?: string } } | null | undefined} entry
 */
export function isNativeCoinMovement(entry) {
    const coin = coinOfChainId(entry?.chainId);
    const descriptor = chainRegistry.get(entry?.chainId) || (coin ? { coin } : null);
    const nativeTicker = NATIVE_TICKER_BY_COIN(descriptor);
    const tick = String(entry?.raw?.tick || '').toUpperCase();
    return Boolean(nativeTicker) && tick === nativeTicker;
}

/**
 * The copy for a pending state, with the one state that has two voices
 * resolved: a confirmed entry speaks of a settled transfer or of an action
 * that had no effect.
 *
 * @param {string} state
 * @param {object} entry
 */
export function pendingCopyFor(state, entry) {
    if (state === 'confirmed' && !isNativeCoinMovement(entry)) return CONFIRMED_NO_EFFECT_COPY;
    return PENDING_COPY[state];
}

/**
 * SEND wire layouts, mirrored from the SDK's `parseActionString`
 * (`xchain-sdk/src/x402.js`). The wallet cannot import it: the SDK is a
 * host-side dependency and `@xchain-wallet/core` ships without it.
 *
 * The exact segment count is part of the contract, not a shortcut. A
 * memo containing a pipe shifts every field after it, so a layout that
 * merely required "at least N segments" would pair one output's amount
 * with another output's destination.
 */
export const SEND_WIRE_LAYOUTS = {
    0: { count: 6,  outputs: [{ tick: 2, amount: 3, destination: 4, memo: 5 }] },
    1: { count: 8,  outputs: [{ tick: 2, amount: 3, destination: 4, memo: 7 },
                              { tick: 2, amount: 5, destination: 6, memo: 7 }] },
    2: { count: 9,  outputs: [{ tick: 2, amount: 3, destination: 4, memo: 8 },
                              { tick: 5, amount: 6, destination: 7, memo: 8 }] },
    3: { count: 10, outputs: [{ tick: 2, amount: 3, destination: 4, memo: 5 },
                              { tick: 6, amount: 7, destination: 8, memo: 9 }] },
};

export const ACTION_NAME_RE = /^[A-Z_]{2,32}$/;

/**
 * The SDK's `isPosNum` (`xchain-sdk/src/x402.js`), the gate every output
 * of `parseActionString` passes: a bare decimal above zero, with no
 * sign, no exponent and no surrounding whitespace. Another hand-copy for
 * the same reason the layouts are, and it drifts as easily.
 *
 * The SDK settles "above zero" through a bignumber; the shape settles it
 * here, since a string of digits is zero exactly when none of them is
 * 1-9. Asking a JS number instead would answer in the wrong arithmetic
 * and there is no third party to hand the parsed value to anyway.
 *
 * @param {unknown} v
 */
export function isWireAmount(v) {
    const s = String(v);
    return /^\d+(\.\d+)?$/.test(s) && /[1-9]/.test(s);
}

/**
 * What a pending transaction is about to do, read off its action data
 * (I-9). SEND v0-v3 is the only layout anything on this platform can
 * parse, so it is the only one this claims to understand. Every other
 * action shows its raw segments under its own name; deriving per-output
 * amounts for one would be inventing them.
 *
 * Amounts travel as the strings the wire carried. Nothing here does
 * arithmetic on them, so there is no precision to lose.
 *
 * @param {{ pending?: { data?: string | null }, raw?: object, action?: string }} entry
 * @returns {{ kind: 'send' | 'segments' | 'local' | 'none', action: string,
 *             outputs: Array<{tick: string, amount: string, destination: string, memo: string}>,
 *             segments: string[] }}
 */
export function describePendingAction(entry) {
    const none = { kind: /** @type {'none'} */ ('none'), action: '', outputs: [], segments: [] };
    const data = entry?.pending?.data;
    if (typeof data !== 'string' || data === '') {
        // Nothing network-reported. Our own record of a send still knows
        // what we asked for, and the panel labels it as ours.
        const raw = entry?.raw || {};
        const amount = raw.amount == null ? '' : String(raw.amount);
        const tick = raw.tick ? String(raw.tick) : '';
        if (!amount || !tick) return none;
        return {
            kind: /** @type {'local'} */ ('local'),
            action: String(entry?.action || ''),
            outputs: [{ tick, amount, destination: String(raw.destination || ''), memo: '' }],
            segments: [],
        };
    }

    const segments = data.normalize('NFC').split('|');
    const wireAction = String(segments[0] || '').trim().toUpperCase();
    const action = ACTION_NAME_RE.test(wireAction)
        ? wireAction
        : String(entry?.action || '').toUpperCase();
    const asSegments = {
        kind: /** @type {'segments'} */ ('segments'), action, outputs: [], segments,
    };
    if (wireAction !== 'SEND') return asSegments;

    const layout = SEND_WIRE_LAYOUTS[Number(String(segments[1] || '').trim())];
    if (!layout || segments.length !== layout.count) return asSegments;
    const outputs = [];
    for (const map of layout.outputs) {
        const amount = String(segments[map.amount] || '');
        // Matched the count but the amount position holds something that
        // is not an amount: not a SEND we understand, and the segments
        // are the honest answer. Whitespace is not trimmed away first
        // because the SDK does not trim either, and this has to fail
        // wherever the SDK fails or the two disagree about what the
        // network will accept.
        if (!isWireAmount(amount)) return asSegments;
        outputs.push({
            tick: String(segments[map.tick] || '').toUpperCase(),
            amount,
            destination: String(segments[map.destination] || ''),
            memo: String(segments[map.memo] || '').trim(),
        });
    }
    return { kind: /** @type {'send'} */ ('send'), action, outputs, segments };
}

export function historyAmountDirection(entry) {
    const pendingDirection = entry?.pending?.direction;
    if (pendingDirection === 'in' || pendingDirection === 'out') return pendingDirection;
    const source = String(entry?.raw?.source ?? entry?.raw?.SOURCE ?? entry?.source ?? '');
    const address = String(entry?.address ?? '');
    if (!source || !address) return null;
    return source.toLowerCase() === address.toLowerCase() ? 'out' : 'in';
}

/**
 * Pull the peer-side address out of a history entry. Cluster O
 * FOLLOWUP 2: extended to action-kind-aware extractors so MESSAGE
 * incoming rows and ORDER_MATCH fill rows surface a usable counterparty
 * (the v0.207.0 implementation only handled the SEND case cleanly;
 * RECEIVE / MESSAGE-incoming / fill rows fell through to either a
 * self-address or null).
 *
 * Returns null when no salient peer address is on the row payload;
 * the caller suppresses the single-peer "Save as contact" prompt.
 *
 * DIVIDEND / AIRDROP rows have their *derived* recipient lists handled
 * by `<RecipientsBlock>` instead; those need an SDK round-trip
 * (holdersFor / listByActionIndex) to materialize the peer set.
 *
 * @param {any} entry
 * @returns {string | null}
 */
export function peerAddressOfEntry(entry) {
    const raw = entry?.raw || {};
    const self = entry?.address;
    const isSelf = (a) => typeof self === 'string' && self.length > 0 && a === self;
    const action = String(entry?.action || '').toUpperCase();

    // ORDER_MATCH / fill rows carry both sides of the trade. The peer
    // is whichever address isn't the wallet's own. Different explorer
    // shapes use different field names; try them in priority order.
    if (action === 'ORDER_MATCH' || action === 'ORDER_FILL' || action === 'ORDERFILL') {
        const candidates = [
            raw.tx0_address, raw.TX0_ADDRESS,
            raw.tx1_address, raw.TX1_ADDRESS,
            raw.give_address, raw.GIVE_ADDRESS,
            raw.get_address, raw.GET_ADDRESS,
            raw.destination, raw.DESTINATION,
            raw.source, raw.SOURCE,
        ];
        for (const a of candidates) {
            if (typeof a === 'string' && a.length > 0 && !isSelf(a)) return a;
        }
        return null;
    }

    // SEND / RECEIVE / MESSAGE / generic: destination if it isn't
    // the wallet's own address (we received), otherwise source if
    // that isn't ours either (we sent).
    const dest = raw.destination ?? raw.DESTINATION ?? raw.recipient ?? raw.RECIPIENT;
    if (typeof dest === 'string' && dest.length > 0 && !isSelf(dest)) return dest;
    const src = raw.source ?? raw.SOURCE;
    if (typeof src === 'string' && src.length > 0 && !isSelf(src)) return src;
    return null;
}

/**
 * Map a chainId like "bitcoin-mainnet" / "litecoin-regtest" to the
 * coin family ("bitcoin" / "litecoin") that the contacts schema
 * expects. Returns null when the chainId is malformed.
 *
 * @param {string | undefined} chainId
 * @returns {string | null}
 */
export function coinOfChainId(chainId) {
    if (typeof chainId !== 'string' || !chainId.includes('-')) return null;
    const [coin] = chainId.split('-', 1);
    return coin || null;
}

export function peerCacheKey(chainId, actionIndex) {
    return `${chainId}:${actionIndex}`;
}

export function formatTimestamp(ts) {
    return formatLocalDateTime(ts) || '-';
}

/** Two chevrons stacked, both pointing the same way. */
export function DoubleChevron({ direction = 'down' }) {
    const top = direction === 'up' ? '3,6 6,3 9,6' : '3,3 6,6 9,3';
    const bot = direction === 'up' ? '3,11 6,8 9,11' : '3,8 6,11 9,8';
    return (
        <svg viewBox="0 0 12 14" width="12" height="14" aria-hidden="true">
            <polyline
                points={top}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <polyline
                points={bot}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}
