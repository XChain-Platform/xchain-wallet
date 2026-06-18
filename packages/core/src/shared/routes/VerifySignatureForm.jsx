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
    Icon,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import pickerStyles from './WalletPicker.module.css';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * @param {object} props
 * @param {() => void} props.onBack
 */
export function VerifySignatureForm({ onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const chains = useMemo(() => chainRegistry.supportedChains().map((c) => ({
        id: c.id,
        label: c.displayName || c.id,
    })), []);
    const [chainId, setChainId] = useState(chains[0]?.id || null);
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
        if (typeof messaging.verifyMessageRequest !== 'function') {
            setError('messaging.verifyMessageRequest is not available in this shell.');
            return;
        }
        setBusy(true);
        try {
            const r = await messaging.verifyMessageRequest({
                chainId,
                address: address.trim(),
                message,
                signature: signature.trim(),
            });
            setResult(r?.valid ? 'valid' : 'invalid');
        } catch (err) {
            setError(err?.message || 'Verification failed.');
        } finally {
            setBusy(false);
        }
    }

    const header = (
        <div className={pickerStyles.header}>
            <button
                type="button"
                onClick={onBack}
                className={pickerStyles.iconBtn}
                aria-label="Back"
                title="Back"
                disabled={busy}
            >
                <Icon.BackIcon />
            </button>
            <span className={pickerStyles.title}>Verify signature</span>
            <span style={{ width: 28 }} />
        </div>
    );

    const formBody = (
        <form onSubmit={handleSubmit} noValidate>
            <div style={{ marginBottom: 'var(--xc-space-3)' }}>
                <ChainPicker
                    chains={chains}
                    selectedChainId={chainId}
                    onChange={setChainId}
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
            {error ? (
                <div role="alert" style={{
                    color: 'var(--xc-danger)',
                    fontSize: 'var(--xc-text-xs)',
                    marginBottom: 'var(--xc-space-2)',
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
                        marginBottom: 'var(--xc-space-3)',
                        borderRadius: 'var(--xc-radius-md)',
                        background: result === 'valid' ? 'var(--xc-surface)' : 'var(--xc-surface)',
                        border: `1px solid ${result === 'valid' ? 'var(--xc-accent-primary)' : 'var(--xc-danger)'}`,
                        color: result === 'valid' ? 'var(--xc-text)' : 'var(--xc-danger)',
                        fontWeight: 600,
                    }}
                >
                    {result === 'valid'
                        ? '✓ Signature is valid for this address.'
                        : '✗ Signature does NOT match this address.'}
                </div>
            ) : null}
            <Button
                type="submit"
                variant="primary"
                block
                loading={busy}
                disabled={busy || message.length === 0 || signature.trim().length === 0 || address.trim().length === 0}
            >
                Verify signature
            </Button>
        </form>
    );

    return (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{formBody}</div> : formBody}
        </Screen>
    );
}
