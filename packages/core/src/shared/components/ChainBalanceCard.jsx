// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

import { ChainBadge, MultisigBadge } from '@xchain-wallet/core/ui';
import styles from './ChainBalanceCard.module.css';

/**
 * One chain's balance summary on the Home screen.
 *
 * Renders the chain badge + per-address aggregate. For each address
 * with a `balances` payload (shape: `{ native, tokens[] }`), the card
 * sums the native quantity and lists every token across every address.
 * Per-address `error` strings surface in the fallback line so a
 * partial fetch failure doesn't hide the entire chain.
 *
 * `multisig` is optional and surfaces the §22 N-of-M / scheme indicator.
 *
 * @param {object} props
 * @param {import('../../registry/validate.js').ChainDescriptor} props.descriptor
 * @param {Array<{ address: string, label: string, balances: any | null, error: string | null }>} props.entries
 * @param {{ threshold: number, cosignerCount: number, scheme: 'p2sh-multisig' | 'p2wsh-multisig' | 'taproot-musig2' } | null} [props.multisig]
 */
export function ChainBalanceCard({ descriptor, entries, multisig }) {
    const totals = aggregate(entries);
    const errors = entries.filter((e) => e.error);
    const allError = errors.length === entries.length && entries.length > 0;
    const native = totals.native;

    return (
        <section
            className={styles.card}
            aria-label={`${descriptor.displayName} balances`}
        >
            <header className={styles.header}>
                <ChainBadge descriptor={descriptor} size="md" />
                <span className={styles.count}>
                    {entries.length === 1
                        ? '1 address'
                        : `${entries.length} addresses`}
                </span>
                {multisig ? (
                    <MultisigBadge
                        threshold={multisig.threshold}
                        cosignerCount={multisig.cosignerCount}
                        scheme={multisig.scheme}
                        size="sm"
                    />
                ) : null}
            </header>

            {native ? (
                <div className={styles.nativeRow}>
                    <span className={styles.nativeAmount}>
                        {formatAmount(native.quantity, native.divisibility)}
                    </span>
                    <span className={styles.nativeSymbol}>{native.symbol}</span>
                </div>
            ) : null}

            {totals.tokens.length > 0 ? (
                <ul className={styles.assetList} aria-label="Tokens">
                    {totals.tokens.map((a) => (
                        <li key={a.tick} className={styles.assetRow}>
                            <span className={styles.assetTicker} title={a.displayName}>
                                {a.tick}
                            </span>
                            <span className={styles.assetQty}>
                                {formatAmount(a.quantity, a.divisibility)}
                            </span>
                        </li>
                    ))}
                </ul>
            ) : null}

            {allError ? (
                <p className={styles.fallback}>
                    Balance unavailable — {errors[0].error}
                </p>
            ) : !native && totals.tokens.length === 0 ? (
                <p className={styles.fallback}>No balances on this chain.</p>
            ) : null}
        </section>
    );
}

function aggregate(entries) {
    /** @type {{ symbol: string, divisibility: number, quantity: bigint } | null} */
    let nativeAcc = null;
    /** @type {Map<string, { tick: string, displayName: string, divisibility: number, quantity: bigint }>} */
    const tokens = new Map();
    for (const entry of entries) {
        const b = entry.balances;
        if (!b || typeof b !== 'object') continue;
        if (b.native && b.native.quantity != null) {
            const q = safeBigInt(b.native.quantity);
            if (nativeAcc === null) {
                nativeAcc = {
                    symbol: b.native.tick || '',
                    divisibility: Number(b.native.divisibility ?? 8),
                    quantity: q,
                };
            } else {
                nativeAcc.quantity += q;
            }
        }
        if (Array.isArray(b.tokens)) {
            for (const a of b.tokens) {
                if (!a || typeof a.tick !== 'string') continue;
                const q = safeBigInt(a.quantity);
                const existing = tokens.get(a.tick);
                if (existing) {
                    existing.quantity += q;
                } else {
                    tokens.set(a.tick, {
                        tick: a.tick,
                        displayName: a.displayName || a.tick,
                        divisibility: Number(a.divisibility ?? 8),
                        quantity: q,
                    });
                }
            }
        }
    }
    return {
        native: nativeAcc
            ? {
                symbol: nativeAcc.symbol,
                divisibility: nativeAcc.divisibility,
                quantity: nativeAcc.quantity.toString(),
            }
            : null,
        tokens: Array.from(tokens.values())
            .map((a) => ({ ...a, quantity: a.quantity.toString() }))
            .sort((a, b) => a.tick.localeCompare(b.tick)),
    };
}

function safeBigInt(v) {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') return BigInt(Math.trunc(v));
    if (typeof v === 'string') {
        const trimmed = v.trim();
        if (!/^-?\d+$/.test(trimmed)) return 0n;
        return BigInt(trimmed);
    }
    return 0n;
}

/**
 * Format an atomic-unit string with the configured divisibility.
 * Trailing zeros are preserved so 0.04210000 BTC reads as 0.04210000
 * — matches the BalanceList convention and BTC-native accounting
 * expectations. Non-divisible (divisibility=0) tokens render as
 * plain integers.
 */
function formatAmount(quantityStr, divisibility) {
    const q = String(quantityStr || '0');
    if (!divisibility || divisibility <= 0) {
        return groupThousands(q);
    }
    const negative = q.startsWith('-');
    const abs = negative ? q.slice(1) : q;
    const padded = abs.padStart(divisibility + 1, '0');
    const whole = padded.slice(0, padded.length - divisibility);
    const frac = padded.slice(padded.length - divisibility);
    const out = `${groupThousands(whole)}.${frac}`;
    return negative ? `-${out}` : out;
}

function groupThousands(s) {
    const n = String(s);
    return n.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
