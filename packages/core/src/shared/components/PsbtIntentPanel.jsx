// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PSBT presentation helpers for the Confirm Standard sign-transaction page.
// The raw input and output inventory is deliberately not a second review UI.
// A readable XChain action uses the same decoded model as an in-wallet action,
// while a transaction with no action becomes a native-coin send model after
// wallet-owned change is removed.
import { StatusMessage } from '@xchain-wallet/core/ui';
import { describeUnreadableReason, isUnreadableActionReason } from './psbtDecodeReasons.js';
import {
    exactNetworkFeeSats,
    exactSats,
    formatExactSats,
    sumExactSats,
} from '../../flows/psbtNetworkFee.js';
import {
    formatNativeBaseUnits,
    tickerForDescriptor,
} from '../../registry/coinTicker.js';
import { formatWithThousands } from '../utils/amountFormat.js';
import styles from './PsbtIntentPanel.module.css';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';

export function amountLabel(value, descriptor) {
    const smallestUnits = formatExactSats(value);
    if (smallestUnits === null) return null;
    if (!descriptor) return `${smallestUnits} sats`;
    const amount = formatNativeBaseUnits(value, descriptor);
    const ticker = tickerForDescriptor(descriptor);
    return amount === null || !ticker ? null : `${formatWithThousands(amount) || amount} ${ticker}`;
}

/**
 * Turn a bare native-coin PSBT into the same decoded and summary inputs the
 * shared confirm model receives for a composed SEND. Change outputs are not
 * recipients. Any positive output without an address stays unexplained and
 * refuses the presentation instead of being hidden.
 *
 * @param {object} args
 * @param {{ inputs?: Array<{value?: number|string}>, outputs?: Array<{address?: string|null, value?: number|string}> } | null} args.decomposed
 * @param {Set<string>} [args.ownAddresses]
 * @param {object} [args.chainDescriptor]
 * @returns {{ actionName: 'SEND', decoded: object, summary: object, feeAmount: string|null, feeText: string|null } | null}
 */
export function barePsbtSendPresentation({ decomposed, ownAddresses, chainDescriptor }) {
    const outputs = Array.isArray(decomposed?.outputs) ? decomposed.outputs : [];
    const own = ownAddresses instanceof Set ? ownAddresses : new Set();
    const ticker = tickerForDescriptor(chainDescriptor);
    if (!ticker || outputs.length === 0) return null;

    const unexplained = outputs.some((output) => {
        if (output?.address) return false;
        const value = exactSats(output?.value);
        return value === null || value > 0n;
    });
    if (unexplained) return null;

    const recipients = outputs
        .filter((output) => output?.address && !own.has(output.address))
        .map((output) => {
            const amount = formatNativeBaseUnits(output.value, chainDescriptor);
            return amount === null ? null : {
                to: output.address,
                tick: ticker,
                amount,
            };
        });
    if (recipients.length === 0 || recipients.some((row) => row === null)) return null;

    const feeSats = exactNetworkFeeSats(decomposed);
    const feeAmount = feeSats === null ? null : formatNativeBaseUnits(feeSats, chainDescriptor);
    const feeText = feeSats === null ? null : amountLabel(feeSats, chainDescriptor);
    if (feeAmount === null || feeText === null) return null;

    if (recipients.length === 1) {
        const recipient = recipients[0];
        const shownAmount = formatWithThousands(recipient.amount) || recipient.amount;
        return {
            actionName: 'SEND',
            decoded: {
                summary: `Send ${shownAmount} ${ticker} to ${recipient.to}.`,
                details: [
                    { label: 'Amount', value: shownAmount },
                    { label: 'Token', value: ticker },
                    { label: 'To', value: recipient.to },
                ],
                warnings: [],
            },
            summary: {
                kind: 'send',
                amount: recipient.amount,
                ticker,
                recipient: recipient.to,
            },
            feeAmount,
            feeText,
        };
    }

    const total = sumExactSats(outputs
        .filter((output) => output?.address && !own.has(output.address))
        .map((output) => output.value));
    const totalAmount = total === null ? null : formatNativeBaseUnits(total, chainDescriptor);
    if (totalAmount === null) return null;
    const shownTotal = formatWithThousands(totalAmount) || totalAmount;
    return {
        actionName: 'SEND',
        decoded: {
            summary: `Send ${shownTotal} ${ticker} to ${recipients.length} recipients.`,
            details: recipients.map((recipient, index) => ({
                label: `Recipient ${index + 1}`,
                value: `${formatWithThousands(recipient.amount) || recipient.amount} ${ticker} to ${recipient.to}`,
            })),
            warnings: [],
        },
        summary: {
            kind: 'multiSend',
            recipients,
            totals: [`${shownTotal} ${ticker}`],
            ticker,
        },
        feeAmount,
        feeText,
    };
}

/**
 * The alert's first sentence for an action the wallet could not read. Names
 * the cause in plain words when the decoder's code has one, and otherwise
 * says only that it could not be read (the raw code is never interpolated).
 *
 * @param {string|null} decodeError
 * @returns {string}
 */
function undecodedSentence(decodeError) {
    const why = describeUnreadableReason(decodeError);
    return why
        ? `The XChain action inside this transaction could not be read because ${why}.`
        : 'The XChain action inside this transaction could not be read.';
}

/**
 * @param {object} props
 * @param {{ inputs: Array<{address?: string, value?: number}>, outputs: Array<{address?: string, value?: number}> } | null} props.decomposed
 * @param {object|null} [props.decodedAction]     decodeActionFromPsbt intent, when the bytes decoded
 * @param {string|null} [props.decodeError]       why the action decode failed / was punted
 * @param {string|null} [props.unavailableMessage] caller-facing reason the transaction is unavailable
 * @param {boolean} [props.loading]
 */
export function PsbtIntentPanel({
    decomposed,
    decodedAction = null,
    decodeError = null,
    unavailableMessage = null,
    loading = false,
}) {
    if (loading) {
        return <p className={styles.actionIntent}>{t('components.psbtIntentPanel.decodingTransaction')}</p>;
    }
    if (!decomposed) {
        // Fail loud (§5.5): a transaction the wallet cannot even decompose is
        // exactly when the user most needs to be cautious.
        return (
            <StatusMessage variant="warning" role="alert" testId="psbt-undecodable">
                {unavailableMessage || (
                    <>
                        {t('components.psbtIntentPanel.thisTransactionCouldNotBe')}
                    </>
                )}
            </StatusMessage>
        );
    }

    if (decodedAction?.summary) {
        return (
            <div className={styles.panel} data-testid="psbt-intent-panel">
                <p className={styles.actionIntent} data-testid="psbt-action-intent">
                    {decodedAction.summary}
                </p>
            </div>
        );
    }
    if (!isUnreadableActionReason(decodeError)) return null;
    return (
        <div className={styles.panel} data-testid="psbt-intent-panel">
            <StatusMessage variant="warning" role="alert" testId="psbt-action-undecoded">
                {undecodedSentence(decodeError)}
            </StatusMessage>
            <details className={styles.details} data-testid="psbt-action-undecoded-details">
                <summary>{t('pending.detail.technicalDetails')}</summary>
                <code>{decodeError}</code>
            </details>
        </div>
    );
}
