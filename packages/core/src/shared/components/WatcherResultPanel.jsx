// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// WatcherResultPanel (§20 / G040 + Cluster W FOLLOWUP 4 + Cluster X
// Step 3. Renders the unsigned PSBT hex + animated QR (XCW or BBQr)
// for cross-device transport when a watcher-mode wallet builds a PSBT.
//
// Originally a private component inside Send.jsx (G040). Extracted to
// shared/components so the rest of the action authoring surface
// (IssueTokenForm / MintForm / DispenserForm / etc.) can render the
// same panel for FOLLOWUP 5's watcher-mode read-only sweep.
//
// Result envelope shape (the buildSendPsbt / buildActionPsbt return):
//   { psbtHex, encoding?, fromAddress?, chainId? }
//
// CTAs:
//   onBuildAnother: "Build another" secondary button (composes
//                    another action of the same kind without leaving
//                    the form)
//   onDone:         "Done" primary button (back to wherever the
//                    form was launched from)
//
// (Send.jsx still passes `onSendAnother` for back-compat; the prop is
// accepted under either name.)

import { useEffect, useMemo, useState } from 'react';
import { AnimatedQrFrames, Button, RadioGroup, StatusMessage } from '../../ui/index.js';
import { CopyButton, FormSection, Textarea } from '../../ui/index.js';
import { AddressText } from '../../ui/index.js';
import { encodeXcwChunks } from '../../uri/psbtQr.js';
import { encodeBbqrPsbtFrames } from '../../uri/bbqrPsbt.js';
import { useToast } from './ToastHost.jsx';
import styles from './WatcherResultPanel.module.css';
import { t } from '../../i18n/index.js';

/**
 * @param {object} props
 * @param {{ psbtHex: string, encoding?: string, fromAddress?: string, chainId?: string }} props.result
 * @param {() => void} [props.onBuildAnother]
 * @param {() => void} [props.onSendAnother]   alias for onBuildAnother (Send.jsx legacy prop name)
 * @param {() => void} props.onDone
 * @param {string} [props.title]               override the default heading
 */
export function WatcherResultPanel({
    result,
    onBuildAnother,
    onSendAnother,
    onDone,
    title = t('components.watcherResultPanel.unsignedTransactionReadyForSigning'),
}) {
    const psbtHex = result?.psbtHex || '';
    const [qrFormat, setQrFormat] = useState('xcw');
    const { announce } = useToast();
    useEffect(() => {
        announce(title);
    }, [announce, title]);
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
    const buildAnother = onBuildAnother || onSendAnother;
    return (
        <>
            <FormSection title={title}>
                <p className={styles.successHint}>
                    {t('components.watcherResultPanel.takeThisTransactionToYour')}
                </p>
                {result?.encoding ? (
                    <dl className={styles.successSummary}>
                        <div className={styles.successRow}>
                            <dt>{t('components.watcherResultPanel.encoding')}</dt>
                            <dd>{result.encoding}</dd>
                        </div>
                        {result.fromAddress ? (
                            <div className={styles.successRow}>
                                <dt>{t('components.placeOrderPanel.from')}</dt>
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
                        legend="QR format"
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
            </FormSection>
            <div className={styles.actions}>
                {buildAnother ? (
                    <Button variant="secondary" onClick={buildAnother}>
                        {t('components.watcherResultPanel.buildAnother')}
                    </Button>
                ) : null}
                <Button variant="primary" onClick={onDone}>{t('common.done')}</Button>
            </div>
        </>
    );
}
