// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §24.3 / Cluster Y FOLLOWUP 1: dedicated scan-and-classify route.
//
// Mounts <QrScanner> as a top-level view. Each scanned frame runs
// through `detectQrContent` (the existing §32.2 classifier, same one
// used by Send's address paste and PsbtSignForm's PSBT input). On the
// first recognized payload the scanner stops and the parent shell
// receives a callback for the matching route.
//
// The route does NOT auto-import secret material (WIF / mnemonic).
// Those classifications surface a clear "use the Import flow" message
// rather than navigating somewhere that could write a secret to the
// vault from a casual scan. Address / BIP21 / xchain-uri / PSBT-hex
// drive the four supported routes.

import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { Button, FormPage, Icon, PageHeader, QrScanner, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { detectQrContent } from '../../uri/detectQrContent.js';
import { parseXchainUri, hardenUriIntentText, safeChainIdParam } from '../../uri/xchainUri.js';
import { neutralizeControlText } from '../utils/textHardening.js';
import { isValidAddressAnyNetwork, isValidAddressForChain } from '../utils/addressValidation.js';
import { t } from '../../i18n/index.js';
import { defaultRegistry } from '../../registry/index.js';

const DEFAULT_CHAIN_REGISTRY = defaultRegistry();
const LOCALLY_VALIDATED_COINS = new Set(['bitcoin', 'litecoin', 'dogecoin']);

function descriptorAcceptsAddress(descriptor, address) {
    if (!LOCALLY_VALIDATED_COINS.has(descriptor.coin)) return true;
    return isValidAddressForChain(address, descriptor.coin, descriptor.networkKind);
}

function resolvePaymentChain({ address, chainId, scheme, chainRegistry }) {
    if (chainId !== undefined) {
        const descriptor = chainRegistry.get(chainId);
        if (!descriptor || (scheme && descriptor.uriScheme.toLowerCase() !== scheme)) {
            return { valid: false };
        }
        return descriptorAcceptsAddress(descriptor, address)
            ? { valid: true, chainId }
            : { valid: false };
    }

    const eligible = chainRegistry.supportedChains().filter((descriptor) => (
        !scheme || descriptor.uriScheme.toLowerCase() === scheme
    ));
    const locallyValidated = eligible.filter((descriptor) => (
        LOCALLY_VALIDATED_COINS.has(descriptor.coin)
    ));
    if (locallyValidated.length === 0) {
        return { valid: eligible.length > 0 };
    }
    const descriptors = locallyValidated.filter((descriptor) => (
        descriptorAcceptsAddress(descriptor, address)
    ));
    if (descriptors.length === 0) return { valid: false };
    return {
        valid: true,
        chainId: descriptors.length === 1 ? descriptors[0].id : undefined,
    };
}

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
 * )} ScanRouteOutcome
 */

/**
 * @param {object} props
 * @param {(outcome: ScanRouteOutcome) => void} props.onClassified
 * @param {() => void} [props.onBack]
 * @param {import('../../registry/index.js').ChainRegistry} [props.chainRegistry]
 * @param {boolean} [props.embedded]
 */
export function ScanRoute({ onClassified, onBack, chainRegistry, embedded = false }) {
    const headingId = useId();
    const [paste, setPaste] = useState('');
    const [status, setStatus] = useState(/** @type {string | null} */ (null));
    const [stopped, setStopped] = useState(false);
    const claimedRef = useRef(false);

    const classify = useCallback((raw) => {
        if (claimedRef.current) return;
        const text = typeof raw === 'string' ? raw.trim() : '';
        if (!text) return;
        const registry = chainRegistry || DEFAULT_CHAIN_REGISTRY;
        const detected = detectQrContent(text, { chainRegistry: registry });

        // xchain: URIs use the richer parser so we get the send/receive
        // intent split + chainId/tick breakdown that detectQrContent
        // surfaces only as a generic 'xchain-uri' wrapper.
        if (detected.type === 'xchain-uri') {
            // A scanned QR is the widest-open untrusted-input
            // surface this parser has (no clipboard, no click-through - just
            // whatever a camera points at), so the fields below run through
            // the same hardening the deep-link boot paths apply before they
            // ever become an editable form value. `address` stays raw; see
            // `hardenUriIntentText`'s own comment for why.
            const intent = hardenUriIntentText(parseXchainUri(text, { chainRegistry: registry }));
            if (intent.chainId && !registry.get(intent.chainId)) {
                setStatus(t('scan.error.paymentRequest'));
                return;
            }
            if (intent.kind === 'send') {
                let resolvedChainId = intent.chainId;
                if (intent.address) {
                    const resolved = resolvePaymentChain({
                        address: intent.address,
                        chainId: intent.chainId,
                        chainRegistry: registry,
                    });
                    if (!resolved.valid) {
                        setStatus(t('scan.error.paymentRequest'));
                        return;
                    }
                    resolvedChainId = resolved.chainId;
                }
                claimedRef.current = true;
                setStopped(true);
                onClassified({
                    kind: 'send',
                    address: intent.address,
                    amount: intent.amount,
                    tick: intent.tick,
                    chainId: resolvedChainId,
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
            const chainParam = detected.parts.params?.chain;
            const chainId = safeChainIdParam(chainParam);
            if (detected.parts.required.length > 0
                || (chainParam !== undefined && chainId === undefined)) {
                setStatus(t('scan.error.paymentRequest'));
                return;
            }
            const resolved = resolvePaymentChain({
                address: detected.address,
                chainId,
                scheme: detected.scheme,
                chainRegistry: registry,
            });
            if (!resolved.valid) {
                setStatus(t('scan.error.paymentRequest'));
                return;
            }
            claimedRef.current = true;
            setStopped(true);
            const tickParam = detected.parts.params?.tick;
            const memoParam = detected.parts.message ?? detected.parts.label;
            // BIP21 parses separately from parseXchainUri (bip21.js, not
            // xchainUri.js), but a scanned `bitcoin:`/`xchain:<addr>` link is
            // the same untrusted-QR surface, so tick/memo get the same
            // neutralization; `address` stays raw for the same reason
            // `hardenUriIntentText` leaves it alone. `chain` needs more than
            // neutralizing because it picks a chain rather than being shown:
            // it takes the same registry-id gate the xchain: road applies to
            // this very param, which this road was missing.
            onClassified({
                kind: 'send',
                address: detected.address,
                amount: detected.parts.amount,
                memo: typeof memoParam === 'string' ? neutralizeControlText(memoParam) : memoParam,
                tick: typeof tickParam === 'string' && tickParam.length > 0
                    ? neutralizeControlText(tickParam).toUpperCase()
                    : undefined,
                chainId: resolved.chainId,
            });
            return;
        }

        if (detected.type === 'address') {
            if (!isValidAddressAnyNetwork(detected.address)) {
                setStatus(t('scan.error.unknown'));
                return;
            }
            const resolved = resolvePaymentChain({
                address: detected.address,
                chainRegistry: registry,
            });
            claimedRef.current = true;
            setStopped(true);
            onClassified({
                kind: 'send',
                address: detected.address,
                chainId: resolved.chainId,
            });
            return;
        }

        if (detected.type === 'psbt-hex') {
            claimedRef.current = true;
            setStopped(true);
            onClassified({ kind: 'psbt', psbtHex: detected.psbtHex });
            return;
        }

        if (detected.type === 'transaction-hex') {
            setStatus(t('scan.error.transactionHex'));
            return;
        }

        if (detected.type === 'backup-pointer') {
            setStatus(t('scan.error.backupPointer'));
            return;
        }

        if (detected.type === 'pairing-code') {
            setStatus(t('scan.error.pairingCode'));
            return;
        }

        if (detected.type === 'wif' || detected.type === 'mnemonic-bip39'
            || detected.type === 'mnemonic-counterwallet') {
            // Secret material from a casual scan: do not auto-import.
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
            // The XCW transport carries PSBTs and long pairing codes. This
            // route recognizes one frame but leaves assembly to the scanner
            // on the destination screen that knows what the payload means.
            setStatus(t('scan.error.xcwChunk', { n: detected.n, total: detected.total }));
            return;
        }

        setStatus(t('scan.error.unknown'));
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
        <PageHeader
            onBack={onBack}
            backLabel={t('common.back')}
            title={t('scan.title')}
            titleId={headingId}
            titleIcon={<Icon.CameraIcon />}
        />
    ), [headingId, onBack]);

    return (
        <Screen
            variant="small"
            header={header}
            bodyAs={embedded ? 'section' : 'main'}
            bodyLabelledBy={headingId}
        >
            <FormPage
                label={t('scan.title')}
                data-testid="scan-route"
                onSubmit={(event) => {
                    event.preventDefault();
                    handlePaste();
                }}
                actions={(
                    <Button
                        type="submit"
                        size="sm"
                        variant="secondary"
                        disabled={!paste.trim() || stopped}
                    >
                        {t('scan.classifyPaste')}
                    </Button>
                )}
            >
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
            </FormPage>
        </Screen>
    );
}
