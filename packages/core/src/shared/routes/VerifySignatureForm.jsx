// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// VerifySignatureForm: §17.5 / G025.
//
// Verify that a signature was produced by a given address over a given
// message. The form does not need a wallet password or signer; it
// hits the chain's SDK auth.verifyMessage, which is pure
// public-key-recovery math.
//
// The address is a free-form input (the user may verify a signature
// from a counterparty's address, not necessarily one of their own).
// The form picks an SDK by chainId. The chain selector offers the
// registry's chains on the active network only: the host refuses an
// address the chosen chain does not accept, and the picker names a chain
// by its coin alone, so a chain from another network would read the same
// and answer every check with "Invalid signature".

import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Screen,
    Icon,
    Input,
    Textarea,
    NetworkField,
    PageHeader,
    StatusMessage,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
// The Wallet Form Standard frame.
import { FormAction, FormFrame, FormSection, SummaryAddress, joinSummaryParts } from '../components/formStandard/index.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useSupportedChains } from '../hooks/useSupportedChains.js';
import { useSettings } from '../hooks/useSettings.js';
import { getActiveNetwork } from '../../flows/effectiveNetwork.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/send.js';
import '../../i18n/locales/en/verifySignature.js';

const chainRegistry = registryLib.defaultRegistry();

/**
 * Remove paste formatting from a base64 signature and reject malformed input.
 *
 * @param {string} value
 * @returns {string | null}
 */
export function normalizeSignatureInput(value) {
    if (typeof value !== 'string') return null;
    const compact = value.replace(/\s+/g, '');
    if (!compact || compact.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
        return null;
    }
    try {
        return atob(compact).length > 0 ? compact : null;
    } catch {
        return null;
    }
}

/**
 * @param {object} props
 * @param {() => void} props.onBack
 */
export function VerifySignatureForm({ onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    // Live registry read: a synced descriptor batch reaches this picker without
    // a restart (the boot sync usually lands after first mount).
    const supportedChains = useSupportedChains(chainRegistry);
    const { settings } = useSettings();
    // No chain until settings answer: the default network is mainnet, and a
    // submit in that window would check a testnet or regtest address there.
    const activeNetwork = settings ? getActiveNetwork(settings) : null;
    const chainIds = useMemo(() => (activeNetwork
        ? supportedChains.filter((c) => c.networkKind === activeNetwork).map((c) => c.id)
        : []), [supportedChains, activeNetwork]);
    const [chainId, setChainId] = useState(/** @type {string | null} */ (null));
    useEffect(() => {
        if (chainId && chainIds.includes(chainId)) return;
        setChainId(chainIds[0] || null);
    }, [chainId, chainIds]);
    const [address, setAddress] = useState('');
    const [message, setMessage] = useState('');
    const [signature, setSignature] = useState('');
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState(/** @type {null | 'valid' | 'invalid' | 'malformed'} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    // Set by a Verify press; each empty required field then shows red
    // with its own message until it is filled.
    const [showMissing, setShowMissing] = useState(false);
    const requestGenerationRef = useRef(0);
    const requestPendingRef = useRef(false);

    function clearSettledFeedback() {
        requestGenerationRef.current += 1;
        setResult(null);
        setError(null);
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (requestPendingRef.current) return;
        setError(null);
        setResult(null);
        if (!chainId) { setError('Pick a network.'); return; }
        if (address.trim().length === 0 || message.length === 0 || signature.trim().length === 0) {
            setShowMissing(true);
            const firstEmpty = address.trim().length === 0 ? 'verify-address'
                : message.length === 0 ? 'verify-message' : 'verify-signature';
            document.getElementById(firstEmpty)?.focus();
            return;
        }
        const normalizedSignature = normalizeSignatureInput(signature);
        if (!normalizedSignature) { setResult('malformed'); return; }
        if (typeof messaging.verifyMessageRequest !== 'function') {
            setError('Signature verification is not available in this app.');
            return;
        }
        const requestGeneration = requestGenerationRef.current + 1;
        requestGenerationRef.current = requestGeneration;
        requestPendingRef.current = true;
        setBusy(true);
        try {
            const r = await messaging.verifyMessageRequest({
                chainId,
                address: address.trim(),
                message,
                signature: normalizedSignature,
            });
            if (requestGenerationRef.current === requestGeneration) {
                setResult(r?.valid ? 'valid' : 'invalid');
            }
        } catch {
            if (requestGenerationRef.current === requestGeneration) {
                setError('Could not verify this signature. Check the network, address, message, and signature.');
            }
        } finally {
            requestPendingRef.current = false;
            setBusy(false);
        }
    }

    const header = (
        <PageHeader onBack={onBack} backDisabled={busy} title={t('verifySignature.title')} />
    );

    // No disabled button and no standing hint; a Verify press marks the empty
    // fields instead.
    const disabledReason = null;
    const addressMissing = showMissing && address.trim().length === 0 ? 'Enter the signer address.' : undefined;
    const messageMissing = showMissing && message.length === 0 ? 'Enter the original message.' : undefined;
    const signatureMissing = showMissing && signature.trim().length === 0 ? 'Enter the signature.' : undefined;

    // Shown just above the Verify button by FormPage's status slot.
    const status = (error || result) ? (
        <>
            <StatusMessage variant="error">{error}</StatusMessage>
            {result ? (
                // A verdict is a result, not a failure, so a failed check keeps
                // the polite status role while it takes the error tone.
                <StatusMessage variant={result === 'valid' ? 'success' : 'error'} role="status">
                    {result === 'valid' ? t('verifySignature.valid') : null}
                    {result === 'invalid' ? t('verifySignature.invalid') : null}
                    {result === 'malformed' ? t('verifySignature.malformed') : null}
                </StatusMessage>
            ) : null}
        </>
    ) : disabledReason ? (
        <StatusMessage id="verify-signature-disabled-reason">
            {disabledReason}
        </StatusMessage>
    ) : null;

    const fields = (
        <>
            <NetworkField
                chainIds={chainIds}
                chainRegistry={chainRegistry}
                value={chainId || ''}
                onChange={(nextChainId) => {
                    setChainId(nextChainId);
                    clearSettledFeedback();
                }}
                label={t('send.fields.chain')}
                help={t('verifySignature.networkHelp')}
                // The chain to verify on, not a source network (no From here).
                notSource
            />
            <Input
                id="verify-address"
                error={addressMissing}
                label={t('verifySignature.address')}
                help={t('verifySignature.addressHelp')}
                value={address}
                onChange={(e) => { setAddress(e.target.value); clearSettledFeedback(); }}
                autoComplete="off"
                dir="ltr"
                placeholder={t('verifySignature.addressPlaceholder')}
            />
            <Textarea
                id="verify-message"
                error={messageMissing}
                dir="auto"
                label={t('verifySignature.message')}
                help={t('verifySignature.messageHelp')}
                value={message}
                onChange={(e) => { setMessage(e.target.value); clearSettledFeedback(); }}
                placeholder={t('verifySignature.messagePlaceholder')}
                rows={5}
                aria-label={t('verifySignature.message')}
            />
            <Textarea
                id="verify-signature"
                error={signatureMissing}
                dir="ltr"
                label={t('verifySignature.signature')}
                help={t('verifySignature.signatureHelp')}
                value={signature}
                onChange={(e) => { setSignature(e.target.value); clearSettledFeedback(); }}
                placeholder={t('verifySignature.signaturePlaceholder')}
                rows={3}
                aria-label={t('verifySignature.signature')}
                style={{ fontFamily: 'var(--xc-font-mono)' }}
            />
        </>
    );

    // The closed summary names the network and the signer address.
    const networkName = chainId ? (chainRegistry.get(chainId)?.displayName || chainId) : '';
    const signatureSummary = joinSummaryParts([
        networkName,
        String(address || '').trim() ? <SummaryAddress address={address} /> : null,
    ]) || null;

    // The Wallet Form Standard. Verify never sends or signs, so it
    // has no From section; the network names the chain of a typed (often
    // someone else's) address, so it stays with that address in the one
    // open Signature section. Notices sit in the status slot above Verify.
    return (
        <Screen variant={variant} header={header}>
            <FormFrame
                label={t('verifySignature.title')}
                onSubmit={handleSubmit}
                status={status}
                action={(
                    <FormAction
                        icon={<Icon.VerifyIcon />}
                        loading={busy}
                        disabled={Boolean(disabledReason)}
                        aria-describedby={disabledReason ? 'verify-signature-disabled-reason' : undefined}
                    >
                        {busy ? t('verifySignature.verifying') : t('verifySignature.title')}
                    </FormAction>
                )}
            >
                <FormSection id="signature" title={t('verifySignature.signature')} icon={Icon.VerifyIcon} defaultOpen main summary={signatureSummary}>
                    {fields}
                </FormSection>
            </FormFrame>
        </Screen>
    );
}
