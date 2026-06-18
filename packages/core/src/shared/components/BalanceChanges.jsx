// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import styles from './BalanceChanges.module.css';

/**
 * Renders a §21.2 simulation result (balance deltas, side-effects, and
 * notes) under a sign screen's headline. Dumb renderer; the caller
 * (Send.jsx review stage in Step 3, SignApproval in Step 4) is
 * responsible for fetching the source-address balances, calling
 * `decoder.simulateAction`, and passing the result here.
 *
 * Renders nothing when the result has no deltas, no side-effects, and
 * no notes; keeps fee-only fallbacks from showing an empty section.
 *
 * @param {object} props
 * @param {import('../../decoder/txSimulator.js').SimulationResult | null} [props.result]
 * @param {boolean} [props.loading]   true while balances are being fetched
 * @param {string | null} [props.error]   set when the balance fetch failed (still renders the section, muted)
 * @param {string} [props.title]      override the section heading (default: "Balance changes")
 */
export function BalanceChanges({ result, loading = false, error = null, title = 'Balance changes' }) {
    if (loading) {
        return (
            <section className={styles.root} data-state="loading" aria-busy="true">
                <h3 className={styles.heading}>{title}</h3>
                <p className={styles.skeleton}>Calculating preview…</p>
            </section>
        );
    }

    if (error) {
        return (
            <section className={styles.root} data-state="error">
                <h3 className={styles.heading}>{title}</h3>
                <p className={styles.error}>(preview unavailable: {error})</p>
            </section>
        );
    }

    if (!result) return null;

    const { deltas = [], sideEffects = [], notes = [] } = result;

    if (deltas.length === 0 && sideEffects.length === 0 && notes.length === 0) {
        return null;
    }

    return (
        <section className={styles.root} aria-label={title}>
            <h3 className={styles.heading}>{title}</h3>

            {deltas.length > 0 ? (
                <dl className={styles.deltas}>
                    {deltas.map((d, i) => (
                        <DeltaRow key={`${d.tick}:${i}`} delta={d} />
                    ))}
                </dl>
            ) : null}

            {sideEffects.length > 0 ? (
                <ul className={styles.sideEffects} aria-label="Side effects">
                    {sideEffects.map((se, i) => (
                        <li key={`${se.kind}:${i}`} className={styles.sideEffect}>
                            <span className={styles.seLabel}>{se.label}</span>
                            <span className={styles.seValue}>{se.value}</span>
                        </li>
                    ))}
                </ul>
            ) : null}

            {notes.length > 0 ? (
                <ul className={styles.notes}>
                    {notes.map((n, i) => (
                        <li key={i} className={styles.note}>{n}</li>
                    ))}
                </ul>
            ) : null}
        </section>
    );
}

function DeltaRow({ delta }) {
    if (delta.isFee) {
        // Label-only row carries `feeAmount` and no before/after. Paired
        // with a coin-debit row above it. When emitted standalone (action
        // has no other coin row), the simulator gives this row a
        // before/after too; render the fee amount in either case.
        const standalone = delta.before !== '' || delta.after !== '';
        return (
            <div
                className={styles.row}
                data-fee="true"
                data-coin={delta.isCoin ? 'true' : undefined}
            >
                <dt className={styles.tick}>Network fee</dt>
                <dd className={styles.amount}>
                    {standalone ? (
                        <>
                            <span className={styles.before}>{delta.before}</span>
                            <span className={styles.arrow}>→</span>
                            <span className={styles.after}>{delta.after}</span>
                            <span className={styles.feeNote}> ({delta.tick} {delta.feeAmount})</span>
                        </>
                    ) : (
                        <span className={styles.feeAmount}>{delta.tick} {delta.feeAmount}</span>
                    )}
                </dd>
            </div>
        );
    }

    const direction = directionOf(delta.before, delta.after);
    return (
        <div
            className={styles.row}
            data-coin={delta.isCoin ? 'true' : undefined}
            data-direction={direction}
        >
            <dt className={styles.tick}>Your {delta.tick}</dt>
            <dd className={styles.amount}>
                <span className={styles.before}>{delta.before}</span>
                <span className={styles.arrow}>→</span>
                <span className={styles.after}>{delta.after}</span>
            </dd>
        </div>
    );
}

/**
 * 'down' when the row debits (after < before), 'up' when it credits,
 * 'flat' otherwise. The renderer uses this for color, not for math.
 */
function directionOf(beforeStr, afterStr) {
    const before = parseLoose(beforeStr);
    const after = parseLoose(afterStr);
    if (after < before) return 'down';
    if (after > before) return 'up';
    return 'flat';
}

function parseLoose(s) {
    if (s === '' || s === null || s === undefined) return 0;
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
}
