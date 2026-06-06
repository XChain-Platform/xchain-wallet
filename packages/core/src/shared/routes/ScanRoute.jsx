// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

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
import { Screen, ScreenHeader, Button, Icon, QrScanner, StatusMessage } from '@xchain-wallet/core/ui';
import { detectQrContent } from '../../uri/detectQrContent.js';
import { parseXchainUri } from '../../uri/xchainUri.js';
import { t } from '../../i18n/index.js';

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
 *   | { kind: 'send', address?: string, amount?: string, tick?: string, chainId?: string, memo?: string, feePriority?: 'low' | 'normal' | 'fast' }
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
        // intent split + chainId/tick breakdown that detectQrContent
        // surfaces only as a generic 'xchain-uri' wrapper.
        if (detected.type === 'xchain-uri') {
            const intent = parseXchainUri(text, { chainRegistry });
            if (intent.kind === 'send') {
                claimedRef.current = true;
                setStopped(true);
                onClassified({
                    kind: 'send',
                    address: intent.address,
                    amount: intent.amount,
                    tick: intent.tick,
                    chainId: intent.chainId,
                    memo: intent.memo,
                    feePriority: intent.feePriority,
                });
                return;
            }
            if (intent.kind === 'receive') {
                claimedRef.current = true;
                setStopped(true);
                onClassified({ kind: 'receive' });
                return;
            }
            setStatus(t('scan.error.unknownXchainIntent'));
            return;
        }

        if (detected.type === 'bip21') {
            claimedRef.current = true;
            setStopped(true);
            const tickParam = detected.parts.params?.tick;
            const chainParam = detected.parts.params?.chain;
            onClassified({
                kind: 'send',
                address: detected.address,
                amount: detected.parts.amount,
                memo: detected.parts.message ?? detected.parts.label,
                tick: typeof tickParam === 'string' && tickParam.length > 0
                    ? tickParam.toUpperCase()
                    : undefined,
                chainId: typeof chainParam === 'string' && chainParam.length > 0
                    ? chainParam
                    : undefined,
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
                    ? t('scan.error.wif')
                    : t('scan.error.mnemonic'),
            );
            return;
        }

        if (detected.type === 'xcw-chunk') {
            // Multi-frame PSBT-over-QR — the scan route only handles
            // single-shot recognition. Direct the user to the Sign panel
            // which mounts the full XCW collector + animated source pane.
            setStatus(t('scan.error.xcwChunk', { n: detected.n, total: detected.total }));
            return;
        }

        setStatus(t('scan.error.unknown', { type: detected.type }));
    }, [chainRegistry, onClassified]);

    const handleFrame = useCallback((text) => { classify(text); }, [classify]);

    const handlePaste = useCallback(() => {
        const text = paste.trim();
        if (!text) {
            setStatus(t('scan.error.pasteEmpty'));
            return;
        }
        classify(text);
    }, [classify, paste]);

    const header = useMemo(() => (
        <ScreenHeader
            onBack={onBack}
            backLabel={t('common.back')}
            title={t('scan.title')}
            titleIcon={<Icon.CameraIcon />}
        />
    ), [onBack]);

    return (
        <Screen variant="small" header={header}>
            <div style={BODY} data-testid="scan-route">
                {!stopped ? (
                    <QrScanner onFrame={handleFrame} alt={t('scan.scannerAlt')} />
                ) : (
                    <StatusMessage variant="success">{t('scan.routing')}</StatusMessage>
                )}
                {status ? (
                    <StatusMessage variant="error">{status}</StatusMessage>
                ) : null}
                <label style={PASTE_LABEL}>
                    {t('scan.pasteLabel')}
                    <textarea
                        value={paste}
                        onChange={(e) => setPaste(e.target.value)}
                        placeholder={t('scan.pastePlaceholder')}
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
                    {t('scan.classifyPaste')}
                </Button>
            </div>
        </Screen>
    );
}
