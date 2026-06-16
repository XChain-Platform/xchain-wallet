// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Transaction simulator — §21.2.
//
// Pure projection of the post-state visible to the user *as a holder
// of the source address*. Given the decoded ACTION + the source
// address's current balances + a fee estimate, returns:
//
//   - `deltas`: per-tick balance changes the source address will
//     experience ({ tick, before, after, isCoin, isFee }). Coin debit
//     for the network fee is a separate row so the sign screen can
//     render it as a fee line.
//
//   - `sideEffects`: protocol-level state changes the user is
//     authoring but that don't show up in their own balances
//     ({ kind, label, value }). Examples: token supply growth on
//     ISSUE/MINT/DESTROY, dispenser open / cancel / refill, dividend
//     payout pool, broadcast publication.
//
//   - `notes`: prose lines the UI renders muted under the deltas
//     ("Contract state changes are not pre-simulated", "Holder count
//     not known until indexed"). The simulator never *invents* a
//     post-state — when it can't be projected, the note says so.
//
// No I/O, no SDK, no vault. The caller fetches the balances via
// `messaging.fetchAddressBalances` (Step 3 / 4) and passes them in.
// That keeps this module trivially testable and keeps the simulator
// usable from both shells and from the renderer's review stage.
//
// Phase 1 covers SEND, SWEEP. Phase 2 adds MINT, DESTROY, ISSUE,
// BROADCAST, DISPENSER (create / cancel / edit), DIVIDEND, LIST,
// AIRDROP, BATCH (recursive). Every other action falls through to a
// generic projection: fee debit only, no token deltas, "balance
// changes for this action type are not pre-simulated" note.

/**
 * @typedef {Object} BalanceDelta
 * @property {string} tick     ticker symbol — coin family for native coin (e.g., "BTC")
 * @property {string} before   pre-tx balance, formatted as a decimal string
 * @property {string} after    post-tx balance, same shape
 * @property {boolean} isCoin  true when this row tracks the native coin (rendered with the fee row)
 * @property {boolean} isFee   true only on the fee-label row (a derived coin debit)
 * @property {string} [feeAmount]  set on isFee rows; the raw fee amount as a decimal string
 */

/**
 * @typedef {Object} SideEffect
 * @property {string} kind   short tag the UI can group by (e.g., "supply", "dispenser", "broadcast")
 * @property {string} label  human label ("MYTOKEN supply")
 * @property {string} value  human value ("+100,000 (newly minted)" or "Opens dispenser at bc1q…")
 */

/**
 * @typedef {Object} SimulationResult
 * @property {BalanceDelta[]} deltas
 * @property {SideEffect[]}   sideEffects
 * @property {string[]}       notes
 */

// `descriptor.coin` is long-form ('bitcoin' / 'litecoin' / 'dogecoin');
// the SDK + protocol use short-form coin tickers ('BTC' / 'LTC' / 'DOGE').
// Mirrors the same map embedded in SwapForm / CoinpayForm so the simulator
// stays importless.
const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

/**
 * @typedef {Object} BalanceLookup
 * @property {string} tick   ticker — coin family ("BTC") for the native coin
 * @property {string} amount string-encoded big-number balance
 * @property {boolean} [isCoin]
 */

/**
 * @param {object} opts
 * @param {string} opts.action
 * @param {Record<string, unknown>} [opts.params]
 * @param {BalanceLookup[]} [opts.balances]   current balances at the source address (token rows + a coin row)
 * @param {string} [opts.feeEstimate]         coin-denominated fee, decimal string
 * @param {string} [opts.chainId]
 * @param {import('../registry/index.js').ChainRegistry} [opts.chainRegistry]
 * @returns {SimulationResult}
 */
export function simulateAction({
    action,
    params,
    balances,
    feeEstimate,
    chainId,
    chainRegistry,
}) {
    const p = params || {};
    const descriptor = chainRegistry && chainId ? chainRegistry.get(chainId) : null;
    const coinTick = descriptor?.coin
        ? PROTOCOL_COIN_TICKER[descriptor.coin] || descriptor.coin.toUpperCase()
        : inferCoinTick(balances);
    const balMap = indexBalances(balances, coinTick);

    if (action === 'SEND') return simulateSend(p, balMap, coinTick, feeEstimate);
    if (action === 'SWEEP') return simulateSweep(p, balMap, coinTick, feeEstimate);
    if (action === 'MINT') return simulateMint(p, balMap, coinTick, feeEstimate);
    if (action === 'DESTROY') return simulateDestroy(p, balMap, coinTick, feeEstimate);
    if (action === 'ISSUE') return simulateIssue(p, balMap, coinTick, feeEstimate);
    if (action === 'DIVIDEND') return simulateDividend(p, balMap, coinTick, feeEstimate);
    if (action === 'DISPENSER') return simulateDispenser(p, balMap, coinTick, feeEstimate);
    if (action === 'BROADCAST') return simulateBroadcast(p, balMap, coinTick, feeEstimate);
    if (action === 'AIRDROP') return simulateAirdrop(p, balMap, coinTick, feeEstimate);
    if (action === 'LIST') return simulateList(p, balMap, coinTick, feeEstimate);
    if (action === 'BATCH') return simulateBatch(p, balMap, coinTick, feeEstimate, chainId, chainRegistry);

    return genericFallback(action, balMap, coinTick, feeEstimate);
}

// --- per-action simulators -----------------------------------------------

function simulateSend(p, balMap, coinTick, feeEstimate) {
    const tick = upper(p.TICK);
    const amount = str(p.AMOUNT);
    const deltas = [];

    if (tick && amount && tick !== coinTick) {
        deltas.push(deltaRow(tick, balMap, neg(amount), false));
    } else if (tick && amount && tick === coinTick) {
        // Coin send — combine principal + fee on the coin row below.
        deltas.push(deltaRow(coinTick, balMap, neg(amount), true));
    }
    pushFeeRow(deltas, balMap, coinTick, feeEstimate);
    return { deltas, sideEffects: [], notes: [] };
}

function simulateSweep(_p, balMap, coinTick, _feeEstimate) {
    // SWEEP empties every non-coin token at the source and the coin
    // (less the fee). The simulator can only project what it knows
    // about — every balance row in balMap goes to zero.
    const deltas = [];
    for (const [tick, before] of balMap.entries()) {
        if (tick === coinTick) continue;
        deltas.push({ tick, before, after: '0', isCoin: false, isFee: false });
    }
    if (coinTick) {
        const coinBefore = balMap.get(coinTick) || '0';
        deltas.push({
            tick: coinTick,
            before: coinBefore,
            after: '0',
            isCoin: true,
            isFee: false,
        });
    }
    return {
        deltas,
        sideEffects: [],
        notes: ['Sweep moves every balance at the source address to the destination.'],
    };
}

function simulateMint(p, balMap, coinTick, feeEstimate) {
    const tick = upper(p.TICK);
    const amount = str(p.AMOUNT);
    const dest = str(p.DESTINATION);
    const deltas = [];
    const sideEffects = [];

    if (tick && amount) {
        // No DESTINATION means the minted supply goes to the broadcasting
        // address (the source). With a DESTINATION the source's holdings
        // don't change — this is a mint to someone else.
        if (!dest) {
            deltas.push(deltaRow(tick, balMap, pos(amount), false));
        }
        sideEffects.push({
            kind: 'supply',
            label: `${tick} supply`,
            value: `+${amount} (newly minted)`,
        });
    }
    pushFeeRow(deltas, balMap, coinTick, feeEstimate);
    return { deltas, sideEffects, notes: [] };
}

function simulateDestroy(p, balMap, coinTick, feeEstimate) {
    const tick = upper(p.TICK);
    const amount = str(p.AMOUNT);
    const deltas = [];
    const sideEffects = [];

    if (tick && amount) {
        deltas.push(deltaRow(tick, balMap, neg(amount), false));
        sideEffects.push({
            kind: 'supply',
            label: `${tick} supply`,
            value: `−${amount} (destroyed)`,
        });
    }
    pushFeeRow(deltas, balMap, coinTick, feeEstimate);
    return {
        deltas,
        sideEffects,
        notes: ['Destroying is irreversible — the tokens cannot be recovered.'],
    };
}

function simulateIssue(p, balMap, coinTick, feeEstimate) {
    const version = str(p.VERSION) || '0';
    const tick = upper(p.TICK);
    const deltas = [];
    const sideEffects = [];
    const notes = [];

    pushFeeRow(deltas, balMap, coinTick, feeEstimate);

    if (version === '0') {
        const maxSupply = str(p.MAX_SUPPLY);
        const mintSupply = str(p.MINT_SUPPLY);
        const transferSupply = str(p.TRANSFER_SUPPLY);
        const transfer = str(p.TRANSFER);
        const isCreate = maxSupply !== '' || mintSupply !== '';
        if (isCreate && tick) {
            sideEffects.push({
                kind: 'token-create',
                label: `${tick}`,
                value: maxSupply
                    ? `New token, max supply ${maxSupply}`
                    : 'New token',
            });
        }
        if (mintSupply && tick) {
            // Initial mint goes to the source unless TRANSFER_SUPPLY routes it elsewhere.
            if (!transferSupply) {
                deltas.push(deltaRow(tick, balMap, pos(mintSupply), false));
            }
            sideEffects.push({
                kind: 'supply',
                label: `${tick} supply`,
                value: `+${mintSupply} (initial)`,
            });
        }
        if (transfer && tick) {
            sideEffects.push({
                kind: 'ownership',
                label: `${tick} ownership`,
                value: `→ ${transfer}`,
            });
        }
    } else if (version === '3') {
        if (tick) {
            sideEffects.push({
                kind: 'lock',
                label: `${tick}`,
                value: 'Locks one or more parameters (irreversible)',
            });
        }
        notes.push('Locking is permanent — these properties cannot be changed after this transaction confirms.');
    } else {
        if (tick) {
            sideEffects.push({
                kind: 'config',
                label: `${tick}`,
                value: 'Configuration update (no supply or balance change)',
            });
        }
    }

    return { deltas, sideEffects, notes };
}

function simulateDividend(p, balMap, coinTick, feeEstimate) {
    const tick = upper(p.TICK);
    const dividendTick = upper(p.DIVIDEND_TICK);
    const amount = str(p.AMOUNT);
    const deltas = [];
    const sideEffects = [];
    const notes = [];

    pushFeeRow(deltas, balMap, coinTick, feeEstimate);

    if (tick && dividendTick && amount) {
        sideEffects.push({
            kind: 'dividend',
            label: 'Dividend pool',
            value: `${amount} ${dividendTick} per unit of ${tick}`,
        });
        notes.push('Total cost depends on the holder count at the snapshot block (excluding the source address). The wallet cannot pre-fetch this — review the indexer estimate before signing.');
    }

    return { deltas, sideEffects, notes };
}

function simulateDispenser(p, balMap, coinTick, feeEstimate) {
    const version = str(p.VERSION) || '0';
    const deltas = [];
    const sideEffects = [];
    const notes = [];

    pushFeeRow(deltas, balMap, coinTick, feeEstimate);

    if (version === '1') {
        sideEffects.push({
            kind: 'dispenser',
            label: 'Dispenser',
            value: 'Cancel — escrow returns to source after a 1-hour close window',
        });
        return { deltas, sideEffects, notes };
    }

    if (version === '2') {
        const giveEscrow = str(p.GIVE_ESCROW);
        const giveTick = upper(p.GIVE_TICK);
        if (giveEscrow && giveTick) {
            deltas.push(deltaRow(giveTick, balMap, neg(giveEscrow), false));
            sideEffects.push({
                kind: 'dispenser',
                label: 'Dispenser escrow',
                value: `+${giveEscrow} ${giveTick} (refill)`,
            });
        } else {
            sideEffects.push({
                kind: 'dispenser',
                label: 'Dispenser',
                value: 'Edit — list / expiration update',
            });
        }
        return { deltas, sideEffects, notes };
    }

    // Version 0 — open. GIVE_ESCROW is locked from the source's
    // balance; GIVE_TICK is the locked tick.
    const giveEscrow = str(p.GIVE_ESCROW);
    const giveTick = upper(p.GIVE_TICK);
    const giveAmount = str(p.GIVE_AMOUNT);
    const getTick = upper(p.GET_TICK);
    const getCoin = upper(p.GET_COIN);
    const getAmount = str(p.GET_AMOUNT);
    const fiatCode = upper(p.FIAT_CODE);
    const fiatAmount = str(p.FIAT_AMOUNT);
    const oracle = str(p.ORACLE_ADDRESS);

    if (giveEscrow && giveTick) {
        deltas.push(deltaRow(giveTick, balMap, neg(giveEscrow), giveTick === coinTick));
    }
    const priceLabel = oracle
        ? `oracle-priced in ${fiatCode || 'FIAT'}`
        : fiatAmount && fiatCode
            ? `${fiatAmount} ${fiatCode}`
            : getTick
                ? `${getAmount || '?'} ${getTick}`
                : `${getAmount || '?'} ${getCoin || coinTick}`;
    sideEffects.push({
        kind: 'dispenser',
        label: 'Dispenser',
        value: `Opens — locks ${giveEscrow || '?'} ${giveTick || '?'}, dispenses ${giveAmount || '?'} ${giveTick || '?'} per ${priceLabel}`,
    });

    return { deltas, sideEffects, notes };
}

function simulateBroadcast(p, balMap, coinTick, feeEstimate) {
    const message = str(p.MESSAGE);
    const value = str(p.VALUE);
    const version = str(p.VERSION) || '0';
    const deltas = [];
    pushFeeRow(deltas, balMap, coinTick, feeEstimate);
    const sideEffects = [];

    if (version === '3') {
        sideEffects.push({
            kind: 'broadcast',
            label: 'Feed result',
            value: value || '(empty)',
        });
    } else if (version === '1') {
        sideEffects.push({
            kind: 'broadcast',
            label: `Oracle ${message || '(unnamed)'}`,
            value: `Publishes value ${value || '(empty)'}`,
        });
    } else if (version === '2') {
        sideEffects.push({
            kind: 'broadcast',
            label: `Feed ${message || '(unnamed)'}`,
            value: 'Publishes feed identifier',
        });
    } else {
        sideEffects.push({
            kind: 'broadcast',
            label: 'Broadcast',
            value: message ? `"${message}"` : '(empty message)',
        });
    }

    return { deltas, sideEffects, notes: [] };
}

function simulateAirdrop(p, balMap, coinTick, feeEstimate) {
    const deltas = [];
    pushFeeRow(deltas, balMap, coinTick, feeEstimate);
    const ticks = toArray(p.TICK);
    const amounts = toArray(p.AMOUNT);
    const drops = Math.max(ticks.length, amounts.length, 1);
    const sideEffects = [
        {
            kind: 'airdrop',
            label: 'Airdrop',
            value: drops === 1
                ? `${str(p.AMOUNT) || str(amounts[0]) || '?'} ${upper(p.TICK) || upper(ticks[0]) || '?'} per recipient`
                : `${drops} drops queued`,
        },
    ];
    return {
        deltas,
        sideEffects,
        notes: ['Total cost depends on the list size at the snapshot block — the wallet cannot pre-fetch this.'],
    };
}

function simulateList(p, balMap, coinTick, feeEstimate) {
    const deltas = [];
    pushFeeRow(deltas, balMap, coinTick, feeEstimate);
    const items = toArray(p.ITEM);
    const type = str(p.TYPE);
    const kind = type === '1' ? 'token' : type === '2' ? 'address' : 'item';
    return {
        deltas,
        sideEffects: [
            {
                kind: 'list',
                label: 'List',
                value: `${items.length} ${kind} entr${items.length === 1 ? 'y' : 'ies'}`,
            },
        ],
        notes: [],
    };
}

function simulateBatch(p, balMap, coinTick, feeEstimate, chainId, chainRegistry) {
    const commands = Array.isArray(p.COMMANDS) ? p.COMMANDS : [];
    if (commands.length === 0) {
        const deltas = [];
        pushFeeRow(deltas, balMap, coinTick, feeEstimate);
        return {
            deltas,
            sideEffects: [],
            notes: ['Batch has no decoded sub-actions — review the raw transaction before signing.'],
        };
    }

    // Recursively simulate each command without a per-step fee, then
    // emit one fee row at the end. Sub-simulators get a snapshot of
    // balMap so a sub-simulator's projected debit doesn't consume
    // headroom for a later sub-action's debit (the projector cares
    // about user-visible deltas, not running balances).
    const aggDeltas = new Map();
    const sideEffects = [];
    const notes = [];

    for (const cmd of commands) {
        if (!cmd || typeof cmd !== 'object') continue;
        const sub = simulateAction({
            action: cmd.action,
            params: cmd.params,
            balances: balancesFromMap(balMap),
            feeEstimate: '0',
            chainId,
            chainRegistry,
        });
        for (const d of sub.deltas) {
            if (d.isFee) continue;
            const cur = aggDeltas.get(d.tick);
            const baseBefore = cur ? cur.before : d.before;
            const stepDelta = subStr(d.after, d.before);
            const newAfter = cur ? addStr(cur.after, stepDelta) : d.after;
            aggDeltas.set(d.tick, {
                tick: d.tick,
                before: baseBefore,
                after: newAfter,
                isCoin: d.isCoin,
                isFee: false,
            });
        }
        for (const se of sub.sideEffects) sideEffects.push(se);
        for (const n of sub.notes) notes.push(n);
    }

    const deltas = [...aggDeltas.values()].filter((d) => d.before !== d.after);
    pushFeeRow(deltas, balMap, coinTick, feeEstimate);
    return { deltas, sideEffects, notes };
}

function genericFallback(action, balMap, coinTick, feeEstimate) {
    const deltas = [];
    pushFeeRow(deltas, balMap, coinTick, feeEstimate);
    return {
        deltas,
        sideEffects: [],
        notes: [
            `Balance changes for "${action || 'unknown action'}" are not pre-simulated. The fee row above is the only confirmed debit.`,
        ],
    };
}

// --- helpers --------------------------------------------------------------

function indexBalances(balances, coinTick) {
    const map = new Map();
    if (!Array.isArray(balances)) return map;
    for (const b of balances) {
        if (!b || !b.tick) continue;
        const key = String(b.tick).toUpperCase();
        const amt = b.amount === undefined || b.amount === null ? '0' : String(b.amount);
        map.set(key, amt);
    }
    if (coinTick && !map.has(coinTick)) map.set(coinTick, '0');
    return map;
}

function balancesFromMap(balMap) {
    const out = [];
    for (const [tick, amount] of balMap.entries()) {
        out.push({ tick, amount });
    }
    return out;
}

function inferCoinTick(balances) {
    if (!Array.isArray(balances)) return '';
    const coinRow = balances.find((b) => b && b.isCoin);
    return coinRow ? String(coinRow.tick).toUpperCase() : '';
}

function deltaRow(tick, balMap, signedDelta, isCoin) {
    const before = balMap.get(tick) || '0';
    const after = addStr(before, signedDelta);
    return { tick, before, after, isCoin: !!isCoin, isFee: false };
}

function pushFeeRow(deltas, balMap, coinTick, feeEstimate) {
    if (!coinTick) return;
    const fee = str(feeEstimate);
    if (!fee || Number(fee) === 0) return;
    // If the coin was already debited (coin send), fold the fee into
    // that row's `after` and emit a separate fee-label row for display.
    const existingCoin = deltas.find((d) => d.isCoin && !d.isFee);
    if (existingCoin) {
        existingCoin.after = addStr(existingCoin.after, neg(fee));
        deltas.push({
            tick: coinTick,
            before: '',
            after: '',
            isCoin: true,
            isFee: true,
            feeAmount: fee,
        });
        return;
    }
    const before = balMap.get(coinTick) || '0';
    const after = addStr(before, neg(fee));
    deltas.push({
        tick: coinTick,
        before,
        after,
        isCoin: true,
        isFee: true,
        feeAmount: fee,
    });
}

function str(v) {
    if (v === undefined || v === null) return '';
    return String(v);
}

function upper(v) {
    return str(v).toUpperCase();
}

function toArray(v) {
    if (v === undefined || v === null || v === '') return [];
    if (Array.isArray(v)) return v.filter((x) => x !== undefined && x !== null && x !== '');
    return [v];
}

function neg(amount) {
    const s = stripLeadingMinus(String(amount));
    return s === '' || s === '0' ? '0' : `-${s}`;
}

function pos(amount) {
    return stripLeadingMinus(String(amount));
}

function stripLeadingMinus(s) {
    return s.startsWith('-') ? s.slice(1) : s;
}

// --- decimal-string add / subtract ---------------------------------------
//
// Balances and amounts arrive as decimal strings (mathjs bignumber on
// the SDK side). The simulator is pure and trivially tested, so it
// uses a tiny string-decimal arithmetic path rather than pulling in
// mathjs. It handles up to 18 fractional digits which covers every
// tick on the platform (BTC: 8, LTC: 8, DOGE: 8, XCP: 8, FILE: 0,
// custom tokens: max 18).

/**
 * a + b on decimal strings; either may carry a leading minus.
 */
function addStr(a, b) {
    const A = parseDec(a);
    const B = parseDec(b);
    const scale = Math.max(A.scale, B.scale);
    const aScaled = A.intPart * (10n ** BigInt(scale - A.scale));
    const bScaled = B.intPart * (10n ** BigInt(scale - B.scale));
    const sum = BigInt(A.sign) * aScaled + BigInt(B.sign) * bScaled;
    return formatScaledBigint(sum, scale);
}

function subStr(a, b) {
    return addStr(a, neg(stripLeadingMinus(String(b))));
}

function parseDec(s) {
    const raw = String(s ?? '0').trim();
    if (raw === '' || raw === '-') return { sign: 1, intPart: 0n, scale: 0 };
    const sign = raw.startsWith('-') ? -1 : 1;
    const body = sign === -1 ? raw.slice(1) : raw;
    const dot = body.indexOf('.');
    if (dot === -1) {
        return { sign, intPart: BigInt(body || '0'), scale: 0 };
    }
    const whole = body.slice(0, dot) || '0';
    const frac = body.slice(dot + 1);
    return {
        sign,
        intPart: BigInt((whole + frac) || '0'),
        scale: frac.length,
    };
}

function formatScaledBigint(value, scale) {
    if (value === 0n) return '0';
    const negative = value < 0n;
    const abs = negative ? -value : value;
    const s = abs.toString().padStart(scale + 1, '0');
    const cut = s.length - scale;
    let whole = s.slice(0, cut);
    let frac = scale > 0 ? s.slice(cut) : '';
    while (frac.endsWith('0')) frac = frac.slice(0, -1);
    const body = frac.length > 0 ? `${whole}.${frac}` : whole;
    return negative ? `-${body}` : body;
}
