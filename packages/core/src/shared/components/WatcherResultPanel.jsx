// WatcherResultPanel — §20 / G040 + Cluster W FOLLOWUP 4 + Cluster X
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
//   onBuildAnother — "Build another" secondary button (composes
//                    another action of the same kind without leaving
//                    the form)
//   onDone         — "Done" primary button (back to wherever the
//                    form was launched from)
//
// (Send.jsx still passes `onSendAnother` for back-compat; the prop is
// accepted under either name.)

import { useCallback, useMemo, useState } from 'react';
import { AnimatedQrFrames, Button, StatusMessage } from '../../ui/index.js';
import { encodeXcwChunks } from '../../uri/psbtQr.js';
import { encodeBbqrPsbtFrames } from '../../uri/bbqrPsbt.js';
import styles from './WatcherResultPanel.module.css';

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
    title = 'Unsigned PSBT — ready for signing',
}) {
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
    const copyHex = useCallback(() => {
        if (!psbtHex) return;
        try { navigator.clipboard?.writeText(psbtHex); } catch { /* best effort */ }
    }, [psbtHex]);
    const formatLabel = qrFormat === 'bbqr' ? 'BBQr (hex)' : 'XCW chunks';
    const buildAnother = onBuildAnother || onSendAnother;
    return (
        <>
            <div className={styles.successCard} role="status" aria-live="polite">
                <h2 className={styles.successTitle}>{title}</h2>
                <p className={styles.successHint}>
                    Take this PSBT to your Signer-mode wallet — paste the hex,
                    or scan the animated QR. Sign there, then paste the signed
                    PSBT into a Full-mode wallet to broadcast.
                </p>
                {result?.encoding ? (
                    <dl className={styles.successSummary}>
                        <div className={styles.successRow}>
                            <dt>Encoding</dt>
                            <dd>{result.encoding}</dd>
                        </div>
                        {result.fromAddress ? (
                            <div className={styles.successRow}>
                                <dt>From</dt>
                                <dd className={styles.successMono}>
                                    {result.fromAddress.slice(0, 8)}…{result.fromAddress.slice(-6)}
                                </dd>
                            </div>
                        ) : null}
                    </dl>
                ) : null}
                <div className={styles.successTxidBlock}>
                    <p className={styles.successLabel}>Unsigned PSBT (hex)</p>
                    <textarea
                        readOnly
                        aria-label="Unsigned PSBT hex"
                        value={psbtHex}
                        rows={6}
                        style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.75rem' }}
                    />
                    <div className={styles.successTxidRow}>
                        <button
                            type="button"
                            className={styles.successLink}
                            onClick={copyHex}
                            aria-label="Copy unsigned PSBT hex"
                        >
                            Copy hex
                        </button>
                    </div>
                </div>
                <div className={styles.successTxidBlock}>
                    <p className={styles.successLabel}>QR format</p>
                    <div role="radiogroup" aria-label="Animated QR format">
                        <label style={{ marginRight: '1rem' }}>
                            <input
                                type="radio"
                                name="watcher-qr-format"
                                value="xcw"
                                checked={qrFormat === 'xcw'}
                                onChange={() => setQrFormat('xcw')}
                            />{' '}
                            XCW (this wallet)
                        </label>
                        <label>
                            <input
                                type="radio"
                                name="watcher-qr-format"
                                value="bbqr"
                                checked={qrFormat === 'bbqr'}
                                onChange={() => setQrFormat('bbqr')}
                            />{' '}
                            BBQr (Sparrow / Coldcard / SeedSigner)
                        </label>
                    </div>
                </div>
                {exportFrames && exportFrames.error ? (
                    <StatusMessage variant="error">{exportFrames.error}</StatusMessage>
                ) : exportFrames && Array.isArray(exportFrames) ? (
                    <>
                        <p className={styles.successLabel}>Animated QR ({formatLabel})</p>
                        <AnimatedQrFrames
                            frames={exportFrames}
                            alt="Unsigned PSBT animated QR"
                        />
                        <details>
                            <summary className={styles.hint}>Plain-text chunks</summary>
                            <textarea
                                readOnly
                                aria-label={`Unsigned PSBT ${formatLabel}`}
                                value={exportFrames.join('\n')}
                                rows={6}
                                style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.75rem' }}
                            />
                        </details>
                    </>
                ) : null}
            </div>
            <div className={styles.actions}>
                {buildAnother ? (
                    <Button variant="secondary" onClick={buildAnother}>
                        Build another
                    </Button>
                ) : null}
                <Button variant="primary" onClick={onDone}>Done</Button>
            </div>
        </>
    );
}
