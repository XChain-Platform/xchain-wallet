// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// BridgeTick: the pure half of the wallet's bridge surfaces.
//
// Three separate jobs, kept out of the components so each is testable without
// a render and so the badge, the picker and the move form all read the SAME
// answer:
//
//   1. Origin-rooted names. A token native to Bitcoin lands on Dogecoin as
//      `BTC.PEPECASH` (xchain-token-bridge.md section 3). Users must see
//      "PEPECASH" with an origin badge, never the rooted string, which is the
//      `USDT.e` presentation that spec cites. parseBridgedTick is the indexer /
//      SDK `parseBridgedTick` rule, stated there as: a `{origin, name}` only
//      when the prefix is a protocol coin, is NOT this chain's own coin, and
//      the tick has exactly one dot.
//
//   2. Which XBRIDGE version a move is. One action name, and the asset plus the
//      chain it sits on decide the leg (xchain-bridge.md section 4,
//      xchain-token-bridge.md section 5). The form must never guess: a v0 on the
//      wrong chain is refused `invalid: XBRIDGE (BTC only)` after the user has
//      paid a miner fee.
//
//   3. Decimal comparison for the below-fee warning (base D13). Amounts and fees
//      are 8dp (up to 18dp for a general token) decimal STRINGS and are compared
//      as such. A float round-trip on money is the one thing this must not do,
//      the rule protocolFeeDisclosure.js already states for the fee line.

import { tickerForCoin, isProtocolCoinTicker } from '../../registry/coinTicker.js';

/** The gas tick, which is bare on every chain and therefore never origin-rooted (token-bridge D35). */
export const GAS_TICK = 'XCHAIN';

/**
 * Split an origin-rooted bridged tick into its origin chain and bare name.
 *
 * @param {string|null|undefined} tick        the stored tick, e.g. 'BTC.PEPECASH'
 * @param {string|null|undefined} [localCoin] this chain's native ticker ('DOGE'),
 *   or a descriptor `coin` ('dogecoin'). When supplied, a tick rooted at THIS
 *   chain's own coin is not bridged (it would be an ordinary subasset), which is
 *   the third clause of the spec's rule. Omit to parse the name alone.
 * @returns {{ origin: string, name: string } | null}
 */
export function parseBridgedTick(tick, localCoin) {
    const raw = String(tick || '').trim();
    if (!raw) return null;
    // Exactly one dot: `BTC.PEPE.CASH` is a subasset of a bridged row, and
    // milestone 1 refuses to bridge dotted names at all, so it is not one.
    const parts = raw.split('.');
    if (parts.length !== 2) return null;
    const origin = parts[0].toUpperCase();
    const name = parts[1];
    if (!name) return null;
    if (!isProtocolCoinTicker(origin)) return null;
    if (localCoin && origin === normalizeCoinTicker(localCoin)) return null;
    return { origin, name };
}

/**
 * What a bridged row is CALLED on screen: the bare name, with the origin
 * carried separately as a badge. Falls through unchanged for a native row.
 *
 * @param {string|null|undefined} tick
 * @param {string|null|undefined} [localCoin]
 * @returns {{ label: string, origin: string | null }}
 */
export function bridgeDisplayTick(tick, localCoin) {
    const parsed = parseBridgedTick(tick, localCoin);
    if (!parsed) return { label: String(tick || ''), origin: null };
    return { label: parsed.name, origin: parsed.origin };
}

/**
 * Which XBRIDGE version moves `tick` off `sourceCoin`, and where it may go.
 *
 * The leg is decided by the asset, never by the user: locking happens on the
 * asset's origin chain and burning on every other one.
 *
 *   XCHAIN on BTC          -> v0 lock,  destination any other coin
 *   XCHAIN off BTC         -> v1 burn,  destination BTC only
 *   a native token         -> v3 lock,  destination any coin the issuer opted in to
 *   an <ORIGIN>.<NAME> row -> v4 burn,  destination ORIGIN only
 *
 * @param {object} args
 * @param {string} args.tick
 * @param {string} args.sourceCoin   native ticker of the chain the move is signed on
 * @returns {{ version: '0'|'1'|'3'|'4', leg: 'lock'|'burn',
 *   fixedDestination: string | null, origin: string | null, reason?: undefined }
 *   | { version: null, leg: null, fixedDestination: null, origin: null, reason: string }}
 *   `fixedDestination` is the only coin the leg may target, or null when the
 *   user chooses. `reason` is the plain-language refusal for a tick that has no
 *   bridge leg at all.
 */
export function bridgeLegFor({ tick, sourceCoin }) {
    const t = String(tick || '').trim();
    const coin = normalizeCoinTicker(sourceCoin);
    if (!t) return refuse('Pick a token to move first.');
    if (!coin) return refuse('Pick the chain this token is on first.');

    if (t.toUpperCase() === GAS_TICK) {
        return coin === 'BTC'
            ? { version: '0', leg: 'lock', fixedDestination: null, origin: 'BTC' }
            : { version: '1', leg: 'burn', fixedDestination: 'BTC', origin: 'BTC' };
    }

    const bridged = parseBridgedTick(t, coin);
    if (bridged) {
        return {
            version: '4', leg: 'burn', fixedDestination: bridged.origin, origin: bridged.origin,
        };
    }

    // A dotted name that is not origin-rooted is a subasset, and milestone 1
    // refuses those at lock time (token-bridge section 3, D15). Saying so here
    // is the difference between a disabled button and a paid-for refusal.
    if (t.includes('.')) {
        return refuse(`${t} is a subasset. Subassets cannot be bridged yet, so it can only move on ${coinDisplay(coin)}.`);
    }

    return { version: '3', leg: 'lock', fixedDestination: null, origin: coin };
}

/**
 * The destination coins an issuer has opted a native token in to.
 *
 * The wire field is a comma list, or the sentinel '-' for none, and EMPTY means
 * "unchanged" rather than "none" (token-bridge section 7, D9/D34), so an empty
 * string here is read as "the issuer never set one" and answers null rather
 * than an empty list. Null and [] are different answers and the callers below
 * say different things about them.
 *
 * @param {string|null|undefined} raw
 * @returns {string[] | null}  null when the field is absent/unknown
 */
export function bridgeChainsList(raw) {
    if (raw === null || raw === undefined) return null;
    const s = String(raw).trim();
    if (!s) return null;
    if (s === '-') return [];
    return s.split(',')
        .map((c) => c.trim().toUpperCase())
        .filter((c) => c.length > 0);
}

/**
 * Why this token cannot move to this chain, in the user's words, or null when
 * it can.
 *
 * @param {object} args
 * @param {string} args.tick
 * @param {string} args.sourceCoin
 * @param {string} args.destCoin
 * @param {string[]|null} [args.bridgeChains]  issuer opt-in list; null = unknown
 * @returns {string | null}
 */
export function bridgeDestinationError({ tick, sourceCoin, destCoin, bridgeChains = null }) {
    const dest = normalizeCoinTicker(destCoin);
    const source = normalizeCoinTicker(sourceCoin);
    if (!dest) return null;
    const leg = bridgeLegFor({ tick, sourceCoin: source });
    if (!leg.version) return leg.reason;

    if (dest === source) {
        return `${displayTick(tick, source)} is already on ${coinDisplay(source)}. Pick a different chain to move it to.`;
    }
    if (leg.fixedDestination && dest !== leg.fixedDestination) {
        // A burn releases the original where it is held. There is no second
        // choice to offer, so name the one destination rather than list what is
        // excluded.
        return `${displayTick(tick, source)} on ${coinDisplay(source)} is a bridged copy of a ${coinDisplay(leg.fixedDestination)} asset.`
            + ` Moving it back releases the original on ${coinDisplay(leg.fixedDestination)}, so ${coinDisplay(dest)} is not a destination for it.`;
    }
    if (leg.leg === 'lock' && leg.version === '3') {
        if (bridgeChains === null) return null;   // unknown: no claim either way
        if (bridgeChains.length === 0) {
            return `${tick}'s issuer has not opened it to the bridge, so it cannot be moved off ${coinDisplay(source)}.`;
        }
        if (!bridgeChains.includes(dest)) {
            return `${tick}'s issuer has not opened it to ${coinDisplay(dest)}.`
                + ` It can be moved to: ${bridgeChains.map(coinDisplay).join(', ')}.`;
        }
    }
    return null;
}

/**
 * Compare two plain decimal strings without touching a float.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number|null}  -1 / 0 / 1, or null when either side is not a plain
 *   non-negative decimal (the caller then makes no claim)
 */
export function compareDecimal(a, b) {
    const pa = splitDecimal(a);
    const pb = splitDecimal(b);
    if (!pa || !pb) return null;
    const intA = pa.int.replace(/^0+(?=\d)/, '');
    const intB = pb.int.replace(/^0+(?=\d)/, '');
    if (intA.length !== intB.length) return intA.length < intB.length ? -1 : 1;
    if (intA !== intB) return intA < intB ? -1 : 1;
    const width = Math.max(pa.frac.length, pb.frac.length);
    const fracA = pa.frac.padEnd(width, '0');
    const fracB = pb.frac.padEnd(width, '0');
    if (fracA === fracB) return 0;
    return fracA < fracB ? -1 : 1;
}

/**
 * The below-fee warning (base D13, section 13).
 *
 * A bridge move costs the flat XBRIDGE_BASE protocol fee whatever it carries,
 * so moving less than the fee spends more than it moves. There is no dust floor
 * in consensus to refuse it (D13 ruled: none), which is exactly why the wallet
 * has to say so before the user signs.
 *
 * Returns null unless BOTH numbers are real: an unquoted fee produces no
 * warning rather than a guessed one, the rule protocolFeeRow.js states for every
 * fee surface in this wallet.
 *
 * @param {object} args
 * @param {string} args.amount           what the user typed
 * @param {string|null} args.fee         the quoted protocol fee, XCHAIN decimal
 * @param {string} args.tick             what is being moved
 * @returns {string | null}
 */
export function belowFeeWarning({ amount, fee, tick }) {
    if (fee === null || fee === undefined) return null;
    const cmp = compareDecimal(String(amount ?? ''), String(fee));
    if (cmp === null || cmp > 0) return null;
    const moving = `${String(amount).trim()} ${String(tick || '').trim()}`;
    const same = cmp === 0;
    return `Moving ${moving} costs ${fee} ${GAS_TICK} in protocol fees, which is `
        + `${same ? 'the same as' : 'more than'} the amount you are moving.`
        + ' The bridge charges the same fee whatever the size, so a bigger move costs no more.';
}

// Wire field order for each user-broadcast XBRIDGE version, mirroring
// xchain-sdk/src/formats.js. Duplicated here rather than imported because the
// SDK is a host-side dependency the popup cannot load, and pinned against the
// SDK's own table by test/unit/routes/bridgeTick.test.js so the copy cannot
// drift silently.
const XBRIDGE_WIRE_FIELDS = {
    0: ['DEST_COIN', 'DEST_ADDRESS', 'AMOUNT', 'MEMO'],
    1: ['BTC_ADDRESS', 'AMOUNT', 'MEMO'],
    3: ['TICK', 'DEST_COIN', 'DEST_ADDRESS', 'AMOUNT', 'MEMO'],
    4: ['TICK', 'ORIGIN_ADDRESS', 'AMOUNT', 'MEMO'],
};

/** Read-only view of the wire field order, for the parity test. */
export function xbridgeWireFields(version) {
    const fields = XBRIDGE_WIRE_FIELDS[String(version)];
    return fields ? fields.slice() : null;
}

/**
 * Serialize XBRIDGE params into the action string the fee quote is priced from.
 *
 * The wallet quotes its protocol fee through `messaging.requoteNativeFee`, which
 * takes an action STRING (the host's own re-quote lane), and the popup has no
 * SDK to build one with. This is the same join FormatSelector.serialize
 * performs for a single-leg format, trailing-empty trim included.
 *
 * @param {Record<string, string>} params
 * @returns {string | null}  null for a version with no user-broadcast format
 */
export function xbridgeActionString(params) {
    const version = String(params?.VERSION ?? '');
    const fields = XBRIDGE_WIRE_FIELDS[version];
    if (!fields) return null;
    const parts = ['XBRIDGE', version];
    for (const field of fields) {
        const value = params[field];
        parts.push(value === null || value === undefined ? '' : String(value));
    }
    while (parts.length > 2 && parts[parts.length - 1] === '') parts.pop();
    return parts.join('|');
}

/**
 * Read a usable protocol fee out of a `/feequote` answer.
 *
 * Deliberately more permissive than the native-fee lane, which refuses a
 * `valid: false` quote because it is about to attach a real on-chain output.
 * This one only draws a warning, and XBRIDGE_BASE is a FLAT gas-schedule entry
 * (xchain-bridge.md section 4, D3), so the figure is right for this action even
 * when the dry run refuses it for a reason the form is about to show anyway
 * (insufficient funds, the commonest one on exactly the screen that needs the
 * warning most). `supported: false` is still nothing: the venue priced no
 * action at all.
 *
 * @param {{ supported?: boolean, xchainFee?: string|number|null } | null} quote
 * @returns {string | null}
 */
export function quotedProtocolFee(quote) {
    if (!quote || quote.supported === false) return null;
    const raw = quote.xchainFee;
    if (raw === undefined || raw === null) return null;
    const amount = String(raw).trim();
    if (!/^\d+(\.\d+)?$/.test(amount) || !/[1-9]/.test(amount)) return null;
    return trimTrailingZeros(amount);
}

// -- small shared bits -------------------------------------------------------

const COIN_DISPLAY = { BTC: 'Bitcoin', LTC: 'Litecoin', DOGE: 'Dogecoin' };

/** 'DOGE' -> 'Dogecoin'; an unknown ticker is shown as itself. */
export function coinDisplay(ticker) {
    const t = normalizeCoinTicker(ticker);
    return COIN_DISPLAY[t] || t;
}

/**
 * Accept either a native ticker ('DOGE') or a descriptor coin id ('dogecoin').
 * Callers hold one or the other depending on whether they came from the chain
 * registry or from an action's wire fields.
 */
function normalizeCoinTicker(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (isProtocolCoinTicker(raw)) return raw.toUpperCase();
    return tickerForCoin(raw.toLowerCase());
}

function displayTick(tick, localCoin) {
    return bridgeDisplayTick(tick, localCoin).label;
}

function refuse(reason) {
    return {
        version: null, leg: null, fixedDestination: null, origin: null, reason,
    };
}

function splitDecimal(value) {
    const s = String(value ?? '').trim();
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    const dot = s.indexOf('.');
    return dot < 0
        ? { int: s, frac: '' }
        : { int: s.slice(0, dot), frac: s.slice(dot + 1) };
}

function trimTrailingZeros(s) {
    if (!/^\d+\.\d+$/.test(s)) return s;
    return s.replace(/0+$/, '').replace(/\.$/, '');
}
