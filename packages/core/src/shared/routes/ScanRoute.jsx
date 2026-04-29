// §24.3 / Cluster Y FOLLOWUP 1 — dedicated scan-and-classify route.
//
// Mounts <QrScanner> as a top-level view. Each scanned frame runs
// through `detectQrContent` (the existing §32.2 classifier — same one
// used by Send's address paste and PsbtSignForm's PSBT input). On the
// first recognized payload the scanner stops and the parent shell
// receives a callback for the matching route.
//
// The route does NOT auto-import secret material (WIF / mnemonic) —
// those classifications surface a clear "use the Import flow" message
// rather than navigating somewhere that could write a secret to the
// vault from a casual scan. Address / BIP21 / xchain-uri / PSBT-hex
// drive the four supported routes.

import { useCallback, useMemo, useRef, useState } from 'react';
import { Screen, Button, Icon, QrScanner, StatusMessage } from '@xchain-wallet/core/ui';
import { detectQrContent } from '../../uri/detectQrContent.js';
import { parseXchainUri } from '../../uri/xchainUri.js';

const HEADER = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--xc-space-2)',
    padding: 'var(--xc-space-2) var(--xc-space-3)',
};
const TITLE = { flex: 1, fontWeight: 600, fontSize: 'var(--xc-text-base)' };
const BODY = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--xc-space-3)',
    padding: 'var(--xc-space-3)',
};
const PASTE_LABEL = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--xc-space-1)',
    fontSize: 'var(--xc-text-sm)',
    color: 'var(--xc-text-muted)',
};
const PASTE_BOX = {
    width: '100%',
    minHeight: '5rem',
    fontFamily: 'var(--xc-font-mono, monospace)',
    fontSize: 'var(--xc-text-xs)',
    padding: 'var(--xc-space-2)',
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-md)',
    background: 'var(--xc-surface-raised)',
    color: 'var(--xc-text)',
    resize: 'vertical',
};

/**
 * @typedef {(
 *   | { kind: 'send', address?: string, amount?: string, asset?: string, chainId?: string, memo?: string }
 *   | { kind: 'receive' }
 *   | { kind: 'psbt', psbtHex: string }
 *   | { kind: 'unrecognized', detected: import('../../uri/detectQrContent.js').QrContent['type'] }
 * )} ScanRouteOutcome
 */

/**
 * @param {object} props
 * @param {(outcome: ScanRouteOutcome) => void} props.onClassified
 * @param {() => void} [props.onBack]
 * @param {import('../../registry/index.js').ChainRegistry} [props.chainRegistry]
 */
export function ScanRoute({ onClassified, onBack, chainRegistry }) {
    const [paste, setPaste] = useState('');
    const [status, setStatus] = useState(/** @type {string | null} */ (null));
    const [stopped, setStopped] = useState(false);
    const claimedRef = useRef(false);

    const classify = useCallback((raw) => {
        if (claimedRef.current) return;
        const text = typeof raw === 'string' ? raw.trim() : '';
        if (!text) return;
        const detected = detectQrContent(text, { chainRegistry });

        // xchain: URIs use the richer parser so we get the send/receive
        // intent split + chainId/asset breakdown that detectQrContent
        // surfaces only as a generic 'xchain-uri' wrapper.
        if (detected.type === 'xchain-uri') {
            const intent = parseXchainUri(text);
            if (intent.kind === 'send') {
                claimedRef.current = true;
                setStopped(true);
                onClassified({
                    kind: 'send',
                    address: intent.address,
                    amount: intent.amount,
                    asset: intent.asset,
                    chainId: intent.chainId,
                    memo: intent.memo,
                });
                return;
            }
            if (intent.kind === 'receive') {
                claimedRef.current = true;
                setStopped(true);
                onClassified({ kind: 'receive' });
                return;
            }
            setStatus('xchain: URI was scanned but the intent was not recognized. Try a clearer code.');
            return;
        }

        if (detected.type === 'bip21') {
            claimedRef.current = true;
            setStopped(true);
            onClassified({
                kind: 'send',
                address: detected.address,
                amount: detected.parts.amount,
                memo: detected.parts.message ?? detected.parts.label,
            });
            return;
        }

        if (detected.type === 'address') {
            claimedRef.current = true;
            setStopped(true);
            onClassified({ kind: 'send', address: detected.address });
            return;
        }

        if (detected.type === 'psbt-hex') {
            claimedRef.current = true;
            setStopped(true);
            onClassified({ kind: 'psbt', psbtHex: detected.psbtHex });
            return;
        }

        if (detected.type === 'wif' || detected.type === 'mnemonic-bip39'
            || detected.type === 'mnemonic-counterwallet') {
            // Secret material from a casual scan — do not auto-import.
            // Surface a clear message and let the user pick the deliberate
            // Import lane themselves.
            setStatus(
                detected.type === 'wif'
                    ? 'A private key (WIF) was scanned. Use Import Wallet → Import WIF to add it deliberately.'
                    : 'A recovery phrase was scanned. Use Import Wallet → Recovery phrase to add it deliberately.',
            );
            return;
        }

        if (detected.type === 'xcw-chunk') {
            // Multi-frame PSBT-over-QR — the scan route only handles
            // single-shot recognition. Direct the user to the Sign panel
            // which mounts the full XCW collector + animated source pane.
            setStatus(
                `Multi-frame PSBT chunk ${detected.n}/${detected.total} — open the Sign panel to capture every frame.`,
            );
            return;
        }

        setStatus(`Scanned content was not recognized (${detected.type}). Try a clearer code.`);
    }, [chainRegistry, onClassified]);

    const handleFrame = useCallback((text) => { classify(text); }, [classify]);

    const handlePaste = useCallback(() => {
        const text = paste.trim();
        if (!text) {
            setStatus('Paste a payload first.');
            return;
        }
        classify(text);
    }, [classify, paste]);

    const header = useMemo(() => (
        <div style={HEADER}>
            {onBack ? (
                <Button
                    size="sm"
                    variant="ghost"
                    onClick={onBack}
                    aria-label="Back"
                >
                    <Icon.BackIcon />
                </Button>
            ) : null}
            <span style={TITLE}>Scan</span>
        </div>
    ), [onBack]);

    return (
        <Screen variant="small" header={header}>
            <div style={BODY} data-testid="scan-route">
                {!stopped ? (
                    <QrScanner onFrame={handleFrame} alt="Scan a QR code" />
                ) : (
                    <StatusMessage variant="success">Scanned — routing…</StatusMessage>
                )}
                {status ? (
                    <StatusMessage variant="error">{status}</StatusMessage>
                ) : null}
                <label style={PASTE_LABEL}>
                    Or paste a payload
                    <textarea
                        value={paste}
                        onChange={(e) => setPaste(e.target.value)}
                        placeholder="xchain:… / bitcoin:… / address / PSBT hex"
                        style={PASTE_BOX}
                        spellCheck={false}
                        autoComplete="off"
                        autoCorrect="off"
                    />
                </label>
                <Button
                    size="sm"
                    variant="secondary"
                    onClick={handlePaste}
                    disabled={!paste.trim() || stopped}
                >
                    Classify pasted payload
                </Button>
            </div>
        </Screen>
    );
}
