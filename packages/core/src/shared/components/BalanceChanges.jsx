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
import { coinToFiatExact } from '../../flows/priceLookup.js';
import { useNativeFiatRates, useTokenFiatRates } from '../hooks/useFiatRate.js';
import { subtractDecimalStrings } from '../utils/amountFormat.js';
import { formatFiatAmount } from '../utils/fiatAmountFormat.js';

/**
 * Renders a §21.2 simulation result (balance deltas, side-effects, and
 * notes) under a sign screen's headline. The caller
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
 * @param {string | null} [props.chainCoin] coin family used to resolve fiat rates
 * @param {string | null} [props.nativeTicker] native ticker; inferred from a coin row when omitted
 * @param {string} [props.fiatCurrency] selected fiat currency
 * @param {boolean} [props.allowCoingeckoFallback] whether price lookup may use its fallback
 */
export function BalanceChanges({
    result,
    loading = false,
    error = null,
    title = 'Balance changes',
    chainCoin = null,
    nativeTicker = null,
    fiatCurrency = 'USD',
    allowCoingeckoFallback = true,
}) {
    const deltas = Array.isArray(result?.deltas) ? result.deltas : [];
    const sideEffects = Array.isArray(result?.sideEffects) ? result.sideEffects : [];
    const notes = Array.isArray(result?.notes) ? result.notes : [];
    const resolvedNativeTicker = String(
        nativeTicker || deltas.find((delta) => delta?.isCoin)?.tick || '',
    ).toUpperCase();
    const currency = String(fiatCurrency || 'USD').toUpperCase();
    const nativeRates = useNativeFiatRates({
        chainCoins: chainCoin ? [chainCoin] : [],
        fiatCurrency: currency,
        allowCoingeckoFallback,
    });
    const tokenRates = useTokenFiatRates({
        tokens: chainCoin && resolvedNativeTicker
            ? deltas
                .filter((delta) => delta?.tick
                    && String(delta.tick).toUpperCase() !== resolvedNativeTicker)
                .map((delta) => ({
                    chainCoin,
                    tick: delta.tick,
                    nativeTicker: resolvedNativeTicker,
                }))
            : [],
        fiatCurrency: currency,
        allowCoingeckoFallback,
    });

    function rateFor(tick) {
        const normalized = String(tick || '').toUpperCase();
        if (!chainCoin || !normalized) return null;
        if (normalized === resolvedNativeTicker) return nativeRates[chainCoin] || null;
        return tokenRates[`${chainCoin}|${normalized}`] || null;
    }

    if (loading) {
        return (
            <section className={styles.root} data-state="loading" aria-busy="true">
                <h3 className={styles.heading}>{title}</h3>
                <p className={styles.skeleton}>Calculating preview…</p>
            </section>
        );
    }

    if (error) {
        // Plain copy only; the raw simulation error string stays in the
        // hover title (unpredictable backend text does not belong in copy).
        return (
            <section className={styles.root} data-state="error">
                <h3 className={styles.heading}>{title}</h3>
                <p className={styles.error} title={String(error)}>
                    (preview unavailable; we couldn’t estimate this transaction’s effect)
                </p>
            </section>
        );
    }

    if (!result) return null;

    if (deltas.length === 0 && sideEffects.length === 0 && notes.length === 0) {
        return null;
    }

    return (
        <section className={styles.root} aria-label={title}>
            <h3 className={styles.heading}>{title}</h3>

            {deltas.length > 0 ? (
                <dl className={styles.deltas}>
                    {deltas.map((d, i) => (
                        <DeltaRow
                            key={`${d.tick}:${i}`}
                            delta={d}
                            fiatRate={rateFor(d.tick)}
                            fiatCurrency={currency}
                            showFiat={Boolean(chainCoin)}
                        />
                    ))}
                </dl>
            ) : null}

            {sideEffects.length > 0 ? (
                <ul className={styles.sideEffects} aria-label="Side effects">
                    {sideEffects.map((se, i) => (
                        <li
                            key={`${se.kind}:${i}`}
                            className={styles.sideEffect}
                            style={{ gridTemplateColumns: 'minmax(0, 1fr)', rowGap: 'var(--xc-space-1)' }}
                        >
                            <span className={styles.seLabel}>{se.label}</span>
                            <span className={styles.seValue}>{stateUnknownPlainly(se.value)}</span>
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

function DeltaRow({ delta, fiatRate, fiatCurrency, showFiat }) {
    // A fee the wallet could not read. It has no amount and no post-state to
    // print, and the branches below would render "( BTC undefined)" or a bare
    // arrow for it. Say unknown, which is the fact.
    if (delta.isFee && delta.feeUnknown) {
        return (
            <div
                className={styles.row}
                style={stackedRowStyle}
                data-fee="true"
                data-fee-unknown="true"
                data-coin={delta.isCoin ? 'true' : undefined}
            >
                <dt className={styles.tick}>{delta.feeLabel || 'Network fee'}</dt>
                <dd className={styles.amount} style={amountStyle}>
                    <ChangeLine
                        signed="− unknown"
                        tick={delta.tick}
                        fiatCurrency={fiatCurrency}
                        showFiat={showFiat}
                    />
                    {delta.before !== '' ? (
                        <span className={styles.feeNote} style={balanceLineStyle}>
                            <span className={styles.before}>{delta.before} {delta.tick}</span>
                            <span className={styles.arrow}>→</span>
                            <span className={styles.after}>unknown</span>
                        </span>
                    ) : null}
                </dd>
            </div>
        );
    }
    // The balance itself could not be read (issue #74), so there is no
    // before or after to print. Say that instead of projecting from zero.
    if (!delta.isFee && delta.beforeUnknown) {
        return (
            <div
                className={styles.row}
                style={stackedRowStyle}
                data-coin={delta.isCoin ? 'true' : undefined}
                data-direction="flat"
                data-before-unknown="true"
            >
                <dt className={styles.tick}>Your {delta.tick}</dt>
                <dd className={styles.amount} style={amountStyle}>
                    <span className={styles.feeNote} style={balanceLineStyle}>
                        <span className={styles.before}>Balance unknown</span>
                    </span>
                </dd>
            </div>
        );
    }
    // The paired balance row: `before` is real, `after` is not projectable
    // because the miner fee above is unknown. directionOf would read the empty
    // string as 0 and colour it as a total debit, so this branch comes first.
    if (!delta.isFee && delta.afterUnknown) {
        return (
            <div
                className={styles.row}
                style={stackedRowStyle}
                data-coin={delta.isCoin ? 'true' : undefined}
                data-direction="flat"
                data-after-unknown="true"
            >
                <dt className={styles.tick}>Your {delta.tick}</dt>
                <dd className={styles.amount} style={amountStyle}>
                    <ChangeLine
                        signed="− unknown"
                        tick={delta.tick}
                        fiatCurrency={fiatCurrency}
                        showFiat={showFiat}
                    />
                    <span className={styles.feeNote} style={balanceLineStyle}>
                        <span className={styles.before}>{delta.before} {delta.tick}</span>
                        <span className={styles.arrow}>→</span>
                        <span className={styles.after}>unknown</span>
                    </span>
                </dd>
            </div>
        );
    }
    if (delta.isFee) {
        // Label-only row carries `feeAmount` and no before/after. Paired
        // with a coin-debit row above it. When emitted standalone (action
        // has no other coin row), the simulator gives this row a
        // before/after too; render the fee amount in either case.
        //
        // A fee row may now be the action's PROTOCOL fee rather than
        // the miner fee, and it can be denominated in XCHAIN rather than the
        // coin, so the label comes from the row when it names itself.
        const standalone = delta.before !== '' || delta.after !== '';
        return (
            <div
                className={styles.row}
                style={stackedRowStyle}
                data-fee="true"
                data-protocol-fee={delta.isProtocolFee ? 'true' : undefined}
                data-coin={delta.isCoin ? 'true' : undefined}
            >
                <dt className={styles.tick}>{delta.feeLabel || 'Network fee'}</dt>
                <dd className={styles.amount} style={amountStyle}>
                    <ChangeLine
                        signed={signedFee(delta.tick, delta.feeAmount)}
                        numericValue={negativeValue(delta.feeAmount)}
                        fiatRate={fiatRate}
                        fiatCurrency={fiatCurrency}
                        showFiat={showFiat}
                    />
                    {standalone ? (
                        <span className={styles.feeNote} style={balanceLineStyle}>
                            <span className={styles.before}>{delta.before} {delta.tick}</span>
                            <span className={styles.arrow}>→</span>
                            <span className={styles.after}>{delta.after} {delta.tick}</span>
                        </span>
                    ) : null}
                </dd>
            </div>
        );
    }

    const direction = directionOf(delta.before, delta.after);
    return (
        <div
            className={styles.row}
            style={stackedRowStyle}
            data-coin={delta.isCoin ? 'true' : undefined}
            data-direction={direction}
        >
            <dt className={styles.tick}>Your {delta.tick}</dt>
            <dd className={styles.amount} style={amountStyle}>
                <ChangeLine
                    signed={signedChange(delta.before, delta.after)}
                    tick={delta.tick}
                    fiatRate={fiatRate}
                    fiatCurrency={fiatCurrency}
                    showFiat={showFiat}
                />
                <span className={styles.feeNote} style={balanceLineStyle}>
                    <span className={styles.before}>{delta.before} {delta.tick}</span>
                    <span className={styles.arrow}>→</span>
                    <span className={styles.after}>{delta.after} {delta.tick}</span>
                </span>
            </dd>
        </div>
    );
}

function ChangeLine({ signed, tick = '', numericValue, fiatRate, fiatCurrency, showFiat }) {
    const numeric = numericValue !== undefined ? numericValue : signed?.startsWith('+')
        ? signed.slice(1)
        : signed?.startsWith('−')
            ? `-${signed.slice(1)}`
            : signed?.startsWith('±') ? '0' : null;
    const fiatValue = numeric !== null ? coinToFiatExact(numeric, fiatRate) : null;
    return (
        <span style={changeLineStyle}>
            <span style={{ fontWeight: 600 }}>{signed}{tick ? ` ${tick}` : ''}</span>
            {showFiat ? (
                <span className={styles.feeNote}>
                    {fiatValue === null
                        ? `Fiat unavailable (${fiatCurrency})`
                        : `≈ ${formatFiatAmount(fiatValue, fiatCurrency)} ${fiatCurrency}`}
                </span>
            ) : null}
        </span>
    );
}

const stackedRowStyle = {
    gridTemplateColumns: 'minmax(0, 1fr)',
    rowGap: 'var(--xc-space-1)',
};

const amountStyle = {
    minWidth: 0,
    overflowWrap: 'anywhere',
    wordBreak: 'normal',
};

const changeLineStyle = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 'var(--xc-space-1) var(--xc-space-2)',
};

const balanceLineStyle = {
    display: 'block',
    marginTop: 'var(--xc-space-1)',
};

function signedFee(tick, amount) {
    const value = String(amount ?? '').trim();
    return value ? `− ${tick} ${value.replace(/^[+-]/, '')}` : `− unknown ${tick}`;
}

function negativeValue(amount) {
    const value = String(amount ?? '').trim().replace(/^[+-]/, '');
    return value ? `-${value}` : null;
}

function signedChange(before, after) {
    const change = subtractDecimalStrings(after, before);
    if (change === null) return '± unknown';
    if (change.startsWith('-')) return `−${change.slice(1)}`;
    if (change === '0') return '±0';
    return `+${change}`;
}

function stateUnknownPlainly(value) {
    return String(value ?? '').replace(/(^|[\s(])\?(?=$|[\s,):])/g, '$1unknown');
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
