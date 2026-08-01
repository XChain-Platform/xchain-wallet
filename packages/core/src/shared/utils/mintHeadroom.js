// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// : how much of a token can still be minted, which is NOT what the
// minter holds. A MINT is bounded by two independent caps the indexer
// enforces (xchain-indexer src/actions/mint.js, mirrored in the SDK's
// preflight check): the per-transaction MAX_MINT, and the remaining
// MAX_SUPPLY headroom (max supply minus current supply). The smaller of
// the two is the largest amount a single MINT can carry; a wallet balance
// has no bearing on it at all.
//
// Supply values arrive as pre-formatted decimal strings ("5000",
// "1000.5"), so every comparison here is exact string/BigInt decimal math.
// Float parsing would misjudge the boundary case that matters most: a
// token sitting exactly at its cap, where the answer must be a hard 0.

/**
 * Split a decimal string into a sign-less BigInt of its digits plus the
 * number of fractional places, rejecting anything that isn't a plain
 * decimal number (no exponents, no separators - the callers hand us
 * explorer-formatted values, and a surprise shape must read as "unknown"
 * rather than as a number we invented).
 *
 * @param {unknown} value
 * @returns {{ digits: bigint, scale: number } | null}
 */
function parseDecimal(value) {
    if (value === null || value === undefined) return null;
    const raw = String(value).trim();
    if (!/^-?\d*(\.\d*)?$/.test(raw) || raw === '' || raw === '.' || raw === '-') return null;
    const negative = raw.startsWith('-');
    const body = negative ? raw.slice(1) : raw;
    const [intPart = '', fracPart = ''] = body.split('.');
    if (intPart === '' && fracPart === '') return null;
    const digits = BigInt(`${intPart || '0'}${fracPart}` || '0');
    return { digits: negative ? -digits : digits, scale: fracPart.length };
}

/** Re-scale a parsed decimal to `scale` fractional places. */
function rescale({ digits, scale }, target) {
    return digits * 10n ** BigInt(target - scale);
}

/** Render a scaled BigInt back to a plain decimal string. */
function render(digits, scale) {
    const negative = digits < 0n;
    const abs = (negative ? -digits : digits).toString().padStart(scale + 1, '0');
    const intPart = abs.slice(0, abs.length - scale);
    const fracPart = scale ? abs.slice(abs.length - scale).replace(/0+$/, '') : '';
    return `${negative ? '-' : ''}${intPart}${fracPart ? `.${fracPart}` : ''}`;
}

/**
 * Compare two decimal strings. Returns null when either side isn't a
 * parseable decimal, so callers can tell "smaller" apart from "unknown".
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {-1 | 0 | 1 | null}
 */
export function compareDecimal(a, b) {
    const pa = parseDecimal(a);
    const pb = parseDecimal(b);
    if (!pa || !pb) return null;
    const scale = Math.max(pa.scale, pb.scale);
    const da = rescale(pa, scale);
    const db = rescale(pb, scale);
    if (da < db) return -1;
    if (da > db) return 1;
    return 0;
}

/**
 * `a - b` as an exact decimal string, floored at 0. Null when either
 * side is unparseable.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {string | null}
 */
export function subtractDecimal(a, b) {
    const pa = parseDecimal(a);
    const pb = parseDecimal(b);
    if (!pa || !pb) return null;
    const scale = Math.max(pa.scale, pb.scale);
    const diff = rescale(pa, scale) - rescale(pb, scale);
    return render(diff < 0n ? 0n : diff, scale);
}

/**
 * The largest amount a single MINT of this token can carry.
 *
 * @param {object} args
 * @param {string | null} [args.maxSupply]    MAX_SUPPLY, null/absent when the token is uncapped
 * @param {string | null} [args.totalSupply]  supply in existence right now
 * @param {string | null} [args.mintMax]      per-transaction MAX_MINT, null/absent when unset
 * @returns {string | null}                   decimal string; '0' at the cap; null when NOTHING bounds
 *                                            the mint (uncapped supply and no MAX_MINT) or when the
 *                                            token record hasn't loaded yet
 */
export function mintHeadroom({ maxSupply = null, totalSupply = null, mintMax = null } = {}) {
    // An uncapped token still has a per-tx cap if MAX_MINT is set, and a
    // capped token still has supply headroom if MAX_MINT is not: each
    // bound stands on its own, and the answer is whichever binds first.
    const supplyRoom = (maxSupply !== null && maxSupply !== undefined)
        ? subtractDecimal(maxSupply, totalSupply ?? '0')
        : null;
    const perTx = parseDecimal(mintMax) ? String(mintMax).trim() : null;
    if (supplyRoom === null) return perTx;
    if (perTx === null) return supplyRoom;
    return compareDecimal(perTx, supplyRoom) === -1 ? perTx : supplyRoom;
}

/**
 * True when `amount` is strictly greater than `headroom`. False when
 * either value is unknown, so an unreadable token record leaves the form
 * ungated rather than blocking every mint on a lookup hiccup.
 *
 * @param {unknown} amount
 * @param {string | null} headroom
 * @returns {boolean}
 */
export function exceedsHeadroom(amount, headroom) {
    if (headroom === null || headroom === undefined) return false;
    return compareDecimal(amount, headroom) === 1;
}

/**
 * Where the chain tip sits relative to a token's public-mint window.
 *
 * D-164: `mintHeadroom` bounds a mint by supply and by MAX_MINT, which is what
 *  needed - and a token can also be un-mintable for a reason that has
 * nothing to do with quantity. `mint.js` refuses with `MINT_START_BLOCK` below
 * MINT_START_BLOCK and with `MINT_STOP_BLOCK` above MINT_STOP_BLOCK, so a form
 * that offers "10 available to mint" while the window is shut is stating
 * something the same screen is about to be told is false.
 *
 * Both bounds are optional and independent: a token may open at a block and
 * never close, or be open from genesis and close at one. `null` for either, or
 * an unknown tip, leaves that side unbounded - an unreadable record must not
 * block a mint the chain would accept.
 *
 * @param {object} args
 * @param {string | number | null} [args.mintStartBlock]
 * @param {string | number | null} [args.mintStopBlock]
 * @param {number | null} [args.tip]   current chain height
 * @returns {{ state: 'open' | 'before' | 'closed' | 'unknown', startBlock: number | null,
 *             stopBlock: number | null, blocksAway: number | null }}
 */
export function mintWindowState({ mintStartBlock = null, mintStopBlock = null, tip = null } = {}) {
    const num = (v) => {
        if (v === null || v === undefined || v === '') return null;
        const n = Number(v);
        // 0 is how the explorer renders "unset" for these fields, the same
        // collapse `mintMax` documents, so it cannot mean "opens at genesis".
        return Number.isFinite(n) && n > 0 ? n : null;
    };
    const startBlock = num(mintStartBlock);
    const stopBlock = num(mintStopBlock);
    const height = Number.isFinite(Number(tip)) && Number(tip) > 0 ? Number(tip) : null;

    if (startBlock === null && stopBlock === null) {
        return { state: 'open', startBlock, stopBlock, blocksAway: null };
    }
    if (height === null) return { state: 'unknown', startBlock, stopBlock, blocksAway: null };
    if (startBlock !== null && height < startBlock) {
        return { state: 'before', startBlock, stopBlock, blocksAway: startBlock - height };
    }
    if (stopBlock !== null && height > stopBlock) {
        return { state: 'closed', startBlock, stopBlock, blocksAway: null };
    }
    return {
        state: 'open',
        startBlock,
        stopBlock,
        blocksAway: stopBlock !== null ? stopBlock - height : null,
    };
}

/**
 * What to tell a minter about a window that is not open, or null when it is.
 *
 * Names the BLOCK rather than a duration: the chain gate is a height, and a
 * time estimate would be a second claim this function cannot stand behind on a
 * chain whose block rate the wallet does not control.
 *
 * @param {ReturnType<typeof mintWindowState>} window
 * @param {string} tick
 * @returns {string | null}
 */
export function mintWindowMessage(window, tick) {
    if (!window) return null;
    const name = String(tick || 'this token').toUpperCase();
    if (window.state === 'before') {
        const away = window.blocksAway === null ? '' : ` (${window.blocksAway} blocks away)`;
        return `Minting ${name} opens at block ${window.startBlock}${away}. `
            + 'The network refuses mints until then.';
    }
    if (window.state === 'closed') {
        return `Minting ${name} closed at block ${window.stopBlock}. No more can be minted.`;
    }
    return null;
}
