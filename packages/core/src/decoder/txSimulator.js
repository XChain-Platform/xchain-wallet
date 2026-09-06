// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Transaction simulator (§21.2).
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
//     post-state; when it can't be projected, the note says so.
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
 * @property {string} tick     ticker symbol (coin family for native coin, e.g., "BTC")
 * @property {string} before   pre-tx balance, formatted as a decimal string
 * @property {string} after    post-tx balance, same shape
 * @property {boolean} isCoin  true when this row tracks the native coin (rendered with the fee row)
 * @property {boolean} isFee   true only on the fee-label row (a derived coin debit)
 * @property {string} [feeAmount]  set on isFee rows; the raw fee amount as a decimal string
 * @property {string} [feeLabel]   set on isFee rows the UI must not label "Network fee"
 * @property {boolean} [isProtocolFee] true on the protocol-fee row
 * @property {boolean} [afterUnknown]  `after` is not projectable; `before` still holds. Renderers
 *                                     must say so rather than printing an empty post-state.
 * @property {boolean} [feeUnknown]    set on an isFee row whose amount could not be determined;
 *                                     the row carries no `feeAmount`.
 */

/**
 * The protocol fee the action itself charges, on top of the miner fee.
 *
 * This is a SECOND debit and the simulator was blind to it, so the
 * confirm screen understated every fee-bearing action. It is not derivable
 * from the PSBT: paid in the native coin it rides as a FEE_DESTINATION
 * OUTPUT (and `inputs - outputs` excludes outputs by construction); paid in
 * XCHAIN it never touches the transaction at all. Either way the caller
 * holds the number - the native-coin lane already quotes it
 * (`quoteNativeFee` -> `requiredFeeSats`) - so it is passed in rather than
 * inferred, and when it is absent the simulator stays silent instead of
 * projecting a zero.
 *
 * @typedef {Object} ProtocolFee
 * @property {string} amount  decimal string in the fee's own tick
 * @property {string} [tick]  ticker the fee is paid in; defaults to the native coin
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
 * @property {string} tick   ticker (coin family, e.g., "BTC" for the native coin)
 * @property {string} amount string-encoded big-number balance
 * @property {boolean} [isCoin]
 */

/**
 * @param {object} opts
 * @param {string} opts.action
 * @param {Record<string, unknown>} [opts.params]
 * @param {BalanceLookup[]} [opts.balances]   current balances at the source address (token rows + a coin row)
 * @param {string|null} [opts.feeEstimate]    coin-denominated MINER fee, decimal string. Three
 *                                            distinct values: a decimal string is the fee;
 *                                            `undefined` means the caller is not projecting one
 *                                            (no fee row); explicit `null` means the fee is
 *                                            UNKNOWN, which is not the same claim as `'0'` and
 *                                            must not be projected as if it were.
 * @param {ProtocolFee} [opts.protocolFee]    the action's own protocol fee, when the caller knows it
 * @param {string} [opts.chainId]
 * @param {import('../registry/index.js').ChainRegistry} [opts.chainRegistry]
 * @returns {SimulationResult}
 */
export function simulateAction({
    action,
    params,
    balances,
    feeEstimate,
    protocolFee,
    chainId,
    chainRegistry,
}) {
    const p = params || {};
    const descriptor = chainRegistry && chainId ? chainRegistry.get(chainId) : null;
    const coinTick = descriptor?.coin
        ? PROTOCOL_COIN_TICKER[descriptor.coin] || descriptor.coin.toUpperCase()
        : inferCoinTick(balances);
    const balMap = indexBalances(balances, coinTick);

    const result = simulateBody(action, p, balMap, coinTick, feeEstimate, chainId, chainRegistry);
    // Applied AFTER the per-action projection so the protocol fee lands on
    // whatever coin row that projection produced (a coin SEND folds its own
    // principal in first), and so a new action type gets it for free.
    applyProtocolFee(result, balMap, coinTick, protocolFee);
    // Say WHY the coin post-state is absent. Without this the row reads as a
    // rendering gap rather than as a fact about the transaction, and the token
    // rows beside it (which are still exact) lose their credibility with it.
    if (feeEstimate === null && coinTick && Array.isArray(result?.notes)) {
        result.notes.push(
            `The network fee could not be read from this transaction, so the projected ${coinTick} balance is not shown.`);
    }
    return result;
}

function simulateBody(action, p, balMap, coinTick, feeEstimate, chainId, chainRegistry) {
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
        // Coin send: combine principal + fee on the coin row below.
        deltas.push(deltaRow(coinTick, balMap, neg(amount), true));
    }
    pushFeeRow(deltas, balMap, coinTick, feeEstimate);
    return { deltas, sideEffects: [], notes: [] };
}

function simulateSweep(p, balMap, coinTick, feeEstimate) {
    // SWEEP is an XChain action (SWEEP.md): it moves TICK balances,
    // ownerships and offer escrow. The native coin is NOT swept - it
    // lives in UTXOs, and the sweep tx pays its fee and returns change
    // to the source. Projecting the coin to zero here told a migrating
    // user their whole coin balance was leaving with the tokens.
    // BALANCES=0 (ownerships only) leaves token balances put too, so
    // the projection follows the flag rather than assuming it.
    const sweepsBalances = str(p.BALANCES ?? '1') !== '0';
    const deltas = [];
    if (sweepsBalances) {
        for (const [tick, before] of balMap.entries()) {
            if (tick === coinTick) continue;
            deltas.push({ tick, before, after: '0', isCoin: false, isFee: false });
        }
    }
    pushFeeRow(deltas, balMap, coinTick, feeEstimate);
    const notes = [sweepsBalances
        ? 'Sweep moves every token balance at the source address to the destination.'
        : 'Sweep moves ownerships only; token balances stay at the source address.'];
    if (coinTick) {
        notes.push(`Your ${coinTick} balance is not swept - only the fee leaves this address.`);
    }
    return { deltas, sideEffects: [], notes };
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
        // don't change (this is a mint to someone else).
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
        notes: ['Destroying is irreversible. The tokens cannot be recovered.'],
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
        notes.push('Locking is permanent. These properties cannot be changed after this transaction confirms.');
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
        notes.push('Total cost depends on the holder count at the snapshot block (excluding the source address). Review the indexer estimate before signing; the wallet cannot pre-fetch this.');
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
            value: 'Cancel: escrow returns to source after a 1-hour close window',
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
                value: 'Edit: list / expiration update',
            });
        }
        return { deltas, sideEffects, notes };
    }

    // Version 0 (open). GIVE_ESCROW is locked from the source's
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
        ? `oracle-priced in ${fiatCode || 'fiat'}`
        : fiatAmount && fiatCode
            ? `${fiatAmount} ${fiatCode}`
            : getTick
                ? `${getAmount || '?'} ${getTick}`
                : `${getAmount || '?'} ${getCoin || coinTick}`;
    sideEffects.push({
        kind: 'dispenser',
        label: 'Dispenser',
        value: `Opens: locks ${giveEscrow || '?'} ${giveTick || '?'}, dispenses ${giveAmount || '?'} ${giveTick || '?'} per ${priceLabel}`,
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
        notes: ['Total cost depends on the list size at the snapshot block. The wallet cannot pre-fetch this.'],
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
            notes: ['Batch has no decoded sub-actions. Review the raw transaction before signing.'],
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
    // Mirrors actionDisplayLabel's fallback ("FOO_BAR" -> "Foo bar") so the
    // note stays plain-language while the simulator stays importless.
    const words = String(action || '').trim().toLowerCase().replace(/[_-]+/g, ' ');
    const verb = words ? words.charAt(0).toUpperCase() + words.slice(1) : 'unknown action';
    return {
        deltas,
        sideEffects: [],
        notes: [
            `Balance changes for "${verb}" are not pre-simulated. The fee row above is the only confirmed debit.`,
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

// An UNKNOWN miner fee, which `'0'` cannot express: `'0'` claims the fee is
// free. Nothing here can be projected, since the coin post-state is `before`
// minus an amount nobody knows, so the honest row keeps `before`, drops
// `after`, and says the fee is unknown. Token rows, side effects and the
// IRREVERSIBLE notes stay untouched, because those are exact and are the
// reason not to suppress the whole simulation.
function pushUnknownFeeRow(deltas, balMap, coinTick) {
    const existingCoin = deltas.find((d) => d.isCoin && !d.isFee);
    if (existingCoin) {
        existingCoin.after = '';
        existingCoin.afterUnknown = true;
        deltas.push({ tick: coinTick, before: '', after: '', isCoin: true, isFee: true, feeUnknown: true });
        return;
    }
    deltas.push({
        tick: coinTick,
        before: balMap.get(coinTick) || '0',
        after: '',
        isCoin: true,
        isFee: true,
        feeUnknown: true,
        afterUnknown: true,
    });
}

function pushFeeRow(deltas, balMap, coinTick, feeEstimate) {
    if (!coinTick) return;
    // Explicit null only. `undefined` still means "this caller projects no fee
    // row at all", which is what most callers pass and must not change.
    if (feeEstimate === null) { pushUnknownFeeRow(deltas, balMap, coinTick); return; }
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

/**
 * Fold the action's protocol fee into the projection.
 *
 * Two payment lanes, one debit shape. In native-coin mode the fee is an
 * extra output to FEE_DESTINATION, so it comes out of the same coin balance
 * the miner fee does and simply has to be added to that row. In XCHAIN mode
 * it is debited from the XCHAIN balance on acceptance, which is a row the
 * projection would otherwise never mention at all.
 *
 * The debit lands on the row the user reads as their post-state; the fee's
 * own amount rides a separate label row so "Network fee" keeps meaning the
 * miner fee and the protocol fee is named as itself.
 */
function applyProtocolFee(result, balMap, coinTick, protocolFee) {
    if (!result || !protocolFee) return;
    const amount = str(protocolFee.amount);
    if (!amount || !Number.isFinite(Number(amount)) || Number(amount) <= 0) return;
    const tick = upper(protocolFee.tick) || coinTick;
    if (!tick) return;
    const isCoin = tick === coinTick;

    const deltas = result.deltas;
    // Fold into whichever row already carries this tick's post-state: the
    // action's own balance row when it has one, otherwise the standalone fee
    // row pushFeeRow emitted (which carries before/after itself).
    const carrier = deltas.find((d) => d.tick === tick && !d.isFee)
        || deltas.find((d) => d.tick === tick && d.isFee && d.before !== '');
    const row = {
        tick,
        before: '',
        after: '',
        isCoin,
        isFee: true,
        isProtocolFee: true,
        feeLabel: 'Protocol fee',
        feeAmount: amount,
    };
    if (carrier && carrier.afterUnknown) {
        // The row it would fold into has no post-state to fold into: the miner
        // fee on it is unknown. Subtracting from `''` would print a post-balance
        // that silently excludes the miner fee, which is the exact conflation
        // the unknown marker exists to stop, and taking the else-branch below
        // would do the same from the raw balance. The fee is still NAMED and
        // priced on this label row; only the post-state stays absent.
    } else if (carrier) {
        carrier.after = addStr(carrier.after, neg(amount));
    } else {
        // Nothing else touches this tick (a zero miner fee, or the XCHAIN
        // lane where the fee is the only movement), so this row is the
        // post-state as well as the label.
        row.before = balMap.get(tick) || '0';
        row.after = addStr(row.before, neg(amount));
    }

    // Sit next to the network-fee row so the two fee lines read together.
    const feeAt = deltas.findIndex((d) => d.isFee && !d.isProtocolFee);
    if (feeAt === -1) deltas.push(row);
    else deltas.splice(feeAt + 1, 0, row);
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
