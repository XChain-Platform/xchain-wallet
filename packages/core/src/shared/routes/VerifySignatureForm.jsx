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
// The form picks an SDK by chainId; the chain selector is populated
// from the registry rather than the wallet, since verification has no
// dependency on what the wallet knows.

import { useMemo, useState } from 'react';
import {
    Screen,
    Button,
    Input,
    ChainPicker,
    FormPage,
    PageHeader,
    StatusMessage,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useSupportedChains } from '../hooks/useSupportedChains.js';

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
    const chainIds = useMemo(() => supportedChains.map((c) => c.id), [supportedChains]);
    const [chainId, setChainId] = useState(chainIds[0] || null);
    const [address, setAddress] = useState('');
    const [message, setMessage] = useState('');
    const [signature, setSignature] = useState('');
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState(/** @type {null | 'valid' | 'invalid'} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));

    async function handleSubmit(event) {
        event.preventDefault();
        if (busy) return;
        setError(null);
        setResult(null);
        if (!chainId) { setError('Pick a chain.'); return; }
        if (address.trim().length === 0) { setError('Enter an address.'); return; }
        if (message.length === 0) { setError('Enter the original message.'); return; }
        if (signature.trim().length === 0) { setError('Enter the signature.'); return; }
        const normalizedSignature = normalizeSignatureInput(signature);
        if (!normalizedSignature) { setError('Enter a valid base64 signature.'); return; }
        if (typeof messaging.verifyMessageRequest !== 'function') {
            setError('Signature verification is not available in this app.');
            return;
        }
        setBusy(true);
        try {
            const r = await messaging.verifyMessageRequest({
                chainId,
                address: address.trim(),
                message,
                signature: normalizedSignature,
            });
            setResult(r?.valid ? 'valid' : 'invalid');
        } catch {
            setError('Could not verify this signature. Check the chain, address, message, and signature.');
        } finally {
            setBusy(false);
        }
    }

    const header = (
        <PageHeader onBack={onBack} backDisabled={busy} title="Verify signature" />
    );

    const disabledReason = address.trim().length === 0
        ? 'Enter the signer address to continue.'
        : message.length === 0
            ? 'Enter the original message to continue.'
            : signature.trim().length === 0
                ? 'Enter the signature to continue.'
                : null;

    // Shown just above the Verify button by FormPage's status slot.
    const status = (error || result) ? (
        <>
            {error ? (
                <div role="alert" style={{
                    color: 'var(--xc-danger-fg)',
                    fontSize: 'var(--xc-text-xs)',
                }}>
                    {error}
                </div>
            ) : null}
            {result ? (
                <div
                    role="status"
                    aria-live="polite"
                    style={{
                        padding: 'var(--xc-space-3)',
                        borderRadius: 'var(--xc-radius-md)',
                        background: 'var(--xc-surface)',
                        border: `1px solid ${result === 'valid' ? 'var(--xc-accent-primary)' : 'var(--xc-danger)'}`,
                        color: result === 'valid' ? 'var(--xc-text)' : 'var(--xc-danger)',
                        fontWeight: 600,
                    }}
                >
                    {result === 'valid'
                        ? 'Signature matches this message and address.'
                        : 'Signature does not match this message and address.'}
                </div>
            ) : null}
        </>
    ) : disabledReason ? (
        <StatusMessage id="verify-signature-disabled-reason">
            {disabledReason}
        </StatusMessage>
    ) : null;

    const fields = (
        <>
            <div style={{ marginBottom: 'var(--xc-space-3)' }}>
                <ChainPicker
                    chainIds={chainIds}
                    chainRegistry={chainRegistry}
                    value={chainId || ''}
                    onChange={(nextChainId) => {
                        setChainId(nextChainId);
                        setResult(null);
                        if (error) setError(null);
                    }}
                    label="Chain"
                />
            </div>
            <Input
                label="Address"
                value={address}
                onChange={(e) => { setAddress(e.target.value); setResult(null); if (error) setError(null); }}
                autoComplete="off"
                placeholder="The address that produced the signature"
            />
            <div style={{ marginBottom: 'var(--xc-space-3)' }}>
                <label
                    htmlFor="verify-message"
                    style={{
                        display: 'block',
                        color: 'var(--xc-text-muted)',
                        fontSize: 'var(--xc-text-sm)',
                        marginBottom: 4,
                    }}
                >
                    Message
                </label>
                <textarea
                    id="verify-message"
                    value={message}
                    onChange={(e) => { setMessage(e.target.value); setResult(null); if (error) setError(null); }}
                    placeholder="The exact text that was signed"
                    rows={5}
                    aria-label="Message"
                    style={{
                        width: '100%',
                        background: 'var(--xc-bg)',
                        color: 'var(--xc-text)',
                        border: '1px solid var(--xc-border)',
                        borderRadius: 'var(--xc-radius-sm)',
                        padding: 'var(--xc-space-2)',
                        fontSize: 'var(--xc-text-sm)',
                        fontFamily: 'inherit',
                        resize: 'vertical',
                    }}
                />
            </div>
            <div style={{ marginBottom: 'var(--xc-space-3)' }}>
                <label
                    htmlFor="verify-signature"
                    style={{
                        display: 'block',
                        color: 'var(--xc-text-muted)',
                        fontSize: 'var(--xc-text-sm)',
                        marginBottom: 4,
                    }}
                >
                    Signature
                </label>
                <textarea
                    id="verify-signature"
                    value={signature}
                    onChange={(e) => { setSignature(e.target.value); setResult(null); if (error) setError(null); }}
                    placeholder="Base64 signature blob"
                    rows={3}
                    aria-label="Signature"
                    style={{
                        width: '100%',
                        background: 'var(--xc-bg)',
                        color: 'var(--xc-text)',
                        border: '1px solid var(--xc-border)',
                        borderRadius: 'var(--xc-radius-sm)',
                        padding: 'var(--xc-space-2)',
                        fontSize: 'var(--xc-text-xs)',
                        fontFamily: 'var(--xc-font-mono)',
                        resize: 'vertical',
                    }}
                />
            </div>
        </>
    );

    return (
        <Screen variant={variant} header={header}>
            <FormPage
                label="Verify signature"
                onSubmit={handleSubmit}
                status={status}
                actions={(
                    <Button
                        type="submit"
                        variant="primary"
                        loading={busy}
                        disabled={Boolean(disabledReason)}
                        aria-describedby={disabledReason ? 'verify-signature-disabled-reason' : undefined}
                    >
                        {busy ? 'Verifying…' : 'Verify signature'}
                    </Button>
                )}
            >
                {fields}
            </FormPage>
        </Screen>
    );
}
