// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// WatcherExport: the body of the unsigned result a watcher-mode wallet
// shows when it builds a PSBT: the hex, an optional encoding summary and the
// animated QR (XCW or BBQr) for cross-device transport. ResultScreen owns
// the notice above it and the action row below it.
//
// Result envelope shape (the buildSendPsbt / buildActionPsbt return):
//   { psbtHex, encoding?, fromAddress?, chainId? }

import { useMemo, useState } from 'react';
import { AnimatedQrFrames, RadioGroup, StatusMessage } from '../../ui/index.js';
import { CopyButton, Textarea } from '../../ui/index.js';
import { AddressText } from '../../ui/index.js';
import { encodeXcwChunks } from '../../uri/psbtQr.js';
import { encodeBbqrPsbtFrames } from '../../uri/bbqrPsbt.js';
import styles from './WatcherExport.module.css';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';
import '../../i18n/locales/en/send.js';

/**
 * @param {object} props
 * @param {{ psbtHex: string, encoding?: string, fromAddress?: string, chainId?: string }} props.result
 */
export function WatcherExport({ result }) {
    const psbtHex = result?.psbtHex || '';
    const [qrFormat, setQrFormat] = useState('xcw');
    const exportFrames = useMemo(() => {
        if (!psbtHex) return null;
        try {
            return qrFormat === 'bbqr'
                ? encodeBbqrPsbtFrames(psbtHex)
                : encodeXcwChunks(psbtHex);
        } catch (e) {
            return { error: e?.message || String(e) };
        }
    }, [psbtHex, qrFormat]);
    const formatLabel = qrFormat === 'bbqr' ? 'BBQr (hex)' : 'XCW chunks';
    return (
        <div className={styles.body}>
            {result?.encoding ? (
                <dl className={styles.successSummary}>
                    <div className={styles.successRow}>
                        <dt>{t('components.watcherResultPanel.encoding')}</dt>
                        <dd>{result.encoding}</dd>
                    </div>
                    {result.fromAddress ? (
                        <div className={styles.successRow}>
                            <dt>{t('send.fields.from')}</dt>
                            <dd className={styles.successMono}>
                                <AddressText address={result.fromAddress} size="sm" />
                            </dd>
                        </div>
                    ) : null}
                </dl>
            ) : null}
            <div className={styles.successTxidBlock}>
                <p className={styles.successLabel}>{t('components.watcherResultPanel.unsignedTransactionHex')}</p>
                <Textarea
                    readOnly
                    aria-label={t('components.watcherResultPanel.unsignedTransactionHex2')}
                    value={psbtHex}
                    rows={6}
                    className={styles.machineText}
                    style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.75rem' }}
                />
                <div className={styles.successTxidRow}>
                    <CopyButton
                        key={psbtHex}
                        value={psbtHex}
                        label={t('components.watcherResultPanel.copyHex')}
                        ariaLabel={t('components.watcherResultPanel.copyUnsignedTransactionHex')}
                    />
                </div>
            </div>
            <div className={styles.successTxidBlock}>
                <RadioGroup
                    legend={t('components.watcherResultPanel.qrFormat')}
                    name="watcher-qr-format"
                    value={qrFormat}
                    onChange={setQrFormat}
                    options={[
                        { value: 'xcw', label: 'XCW (this wallet)' },
                        { value: 'bbqr', label: 'BBQr (Sparrow / Coldcard / SeedSigner)' },
                    ]}
                    role="radiogroup"
                    aria-label={t('components.watcherResultPanel.animatedQrFormat')}
                />
            </div>
            {exportFrames && exportFrames.error ? (
                <StatusMessage variant="error">{exportFrames.error}</StatusMessage>
            ) : exportFrames && Array.isArray(exportFrames) ? (
                <>
                    <p className={styles.successLabel}>{t('components.watcherResultPanel.animatedQr')}{formatLabel})</p>
                    <AnimatedQrFrames
                        frames={exportFrames}
                        alt={t('components.watcherResultPanel.unsignedTransactionAnimatedQr')}
                        announceLoading={false}
                    />
                    <details>
                        <summary className={styles.hint}>{t('components.watcherResultPanel.plainTextChunks')}</summary>
                        <Textarea
                            readOnly
                            aria-label={t('components.watcherResultPanel.unsignedTransaction', { formatLabel })}
                            value={exportFrames.join('\n')}
                            rows={6}
                            className={styles.machineText}
                            style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.75rem' }}
                        />
                    </details>
                </>
            ) : null}
        </div>
    );
}
