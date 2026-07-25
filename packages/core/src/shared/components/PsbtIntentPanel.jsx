// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PsbtIntentPanel ( §5.5, the PSBT variant's foregrounded content).
//
// On the action variant the decoded action IS the thing to verify. On a
// PSBT the wallet did not build, it is not: the theft in a hostile PSBT is
// the OUTPUT SET (where the coins go), and the action data is at most a
// hint. So this panel enumerates every input and every output in full,
// marks which inputs the chosen key actually signs and which outputs come
// back as change, and treats a failed decode as a LOUD state rather than
// a missing line.
//
// Amounts stay in the chain's smallest unit (sats). The wallet cannot
// convert without a descriptor for the PSBT's chain, and a guessed
// conversion on a signing surface is worse than an honest raw number
// (§3.5.5: never prettify what you cannot verify).

import { AddressText } from '@xchain-wallet/core/ui';
import { isUnreadableActionReason } from './psbtDecodeReasons.js';
import styles from './PsbtIntentPanel.module.css';

/**
 * @param {object} props
 * @param {{ inputs: Array<{address?: string, value?: number}>, outputs: Array<{address?: string, value?: number}> } | null} props.decomposed
 * @param {Set<string>} [props.ownAddresses]      wallet-owned addresses (change + own-input marking)
 * @param {string} [props.signingAddress]         the address whose key will sign
 * @param {object|null} [props.decodedAction]     decodeActionFromPsbt intent, when the bytes decoded
 * @param {string|null} [props.decodeError]       why the action decode failed / was punted
 * @param {boolean} [props.loading]
 */
export function PsbtIntentPanel({
    decomposed,
    ownAddresses,
    signingAddress,
    decodedAction = null,
    decodeError = null,
    loading = false,
}) {
    if (loading) {
        return <p className={styles.actionIntent}>Decoding transaction…</p>;
    }
    if (!decomposed) {
        // Fail loud (§5.5): a transaction the wallet cannot even decompose is
        // exactly when the user most needs to be cautious.
        return (
            <p className={styles.undecoded} role="alert" data-testid="psbt-undecodable">
                This transaction could not be decoded, so the wallet cannot show you
                what it does. Only continue if you trust where it came from.
            </p>
        );
    }

    const own = ownAddresses instanceof Set ? ownAddresses : new Set();
    const inputs = Array.isArray(decomposed.inputs) ? decomposed.inputs : [];
    const outputs = Array.isArray(decomposed.outputs) ? decomposed.outputs : [];

    const inputsHaveValue = inputs.length > 0 && inputs.every((i) => typeof i.value === 'number');
    const totalIn = inputsHaveValue ? inputs.reduce((a, i) => a + (i.value || 0), 0) : null;
    const totalOut = outputs.reduce((a, o) => a + (o.value || 0), 0);
    const fee = totalIn != null ? totalIn - totalOut : null;
    const leaving = outputs
        .filter((o) => !o.address || !own.has(o.address))
        .reduce((a, o) => a + (o.value || 0), 0);

    return (
        <div className={styles.panel} data-testid="psbt-intent-panel">
            {/* The action data, when it decoded, is context ABOVE the output
                set - never a substitute for it. */}
            {decodedAction?.summary ? (
                <p className={styles.actionIntent} data-testid="psbt-action-intent">
                    {decodedAction.summary}
                </p>
            ) : isUnreadableActionReason(decodeError) ? (
                // An action IS in here and the wallet could not read it. Loud:
                // this is the case where the output set is the ONLY thing the
                // user can verify.
                <p className={styles.undecoded} role="alert" data-testid="psbt-action-undecoded">
                    {`The XChain action inside this transaction could not be read (${decodeError}). `}
                    Verify the amounts and destinations below before you sign.
                </p>
            ) : (
                // No action at all: an ordinary payment. Stating that plainly is
                // honest; an alert here would cry wolf on the common case and
                // train the user to click through the warnings that matter.
                <p className={styles.actionIntent} data-testid="psbt-action-none">
                    Ordinary payment: this transaction carries no XChain action.
                </p>
            )}

            <div className={styles.section}>
                <p className={styles.sectionLabel}>
                    Inputs ({inputs.length}) - what this transaction spends
                </p>
                {inputs.map((inp, i) => {
                    const isOwn = !!inp.address && own.has(inp.address);
                    const signs = !!inp.address && !!signingAddress && inp.address === signingAddress;
                    return (
                        <div className={styles.row} key={`in-${i}`}>
                            <span className={signs ? styles.tag : styles.tagMuted}>
                                {signs ? 'Signs with your key' : isOwn ? 'Your address' : 'Other signer'}
                            </span>
                            {inp.address
                                ? <span className={styles.addr}><AddressText address={inp.address} /></span>
                                : <span className={styles.dataOutput}>(unknown source script)</span>}
                            <span className={styles.value}>
                                {typeof inp.value === 'number' ? `${inp.value.toLocaleString()} sats` : 'amount unknown'}
                            </span>
                        </div>
                    );
                })}
            </div>

            <div className={styles.section}>
                <p className={styles.sectionLabel}>
                    Outputs ({outputs.length}) - where the coins go
                </p>
                {outputs.map((o, i) => {
                    const isChange = !!o.address && own.has(o.address);
                    return (
                        <div className={styles.row} key={`out-${i}`}>
                            <span className={isChange ? styles.tagMuted : styles.tag}>
                                {isChange ? 'Change (back to you)' : 'Recipient'}
                            </span>
                            {o.address
                                ? <span className={styles.addr}><AddressText address={o.address} /></span>
                                : <span className={styles.dataOutput}>(data / non-address output)</span>}
                            <span className={styles.value}>
                                {(o.value || 0).toLocaleString()} sats
                            </span>
                        </div>
                    );
                })}
            </div>

            <dl className={styles.totals}>
                <dt className={styles.totalsLabel}>Leaving this wallet</dt>
                <dd className={styles.totalsValue}>{leaving.toLocaleString()} sats</dd>
                <dt className={styles.totalsLabel}>Total in</dt>
                <dd className={styles.totalsValue}>
                    {totalIn != null ? `${totalIn.toLocaleString()} sats` : 'unavailable'}
                </dd>
                <dt className={styles.totalsLabel}>Total out</dt>
                <dd className={styles.totalsValue}>{totalOut.toLocaleString()} sats</dd>
                <dt className={styles.totalsLabel}>Network fee</dt>
                <dd className={styles.totalsValue}>
                    {fee != null ? `${fee.toLocaleString()} sats` : 'unavailable'}
                </dd>
            </dl>
        </div>
    );
}
