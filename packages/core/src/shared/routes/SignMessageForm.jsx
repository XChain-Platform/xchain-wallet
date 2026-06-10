// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// SignMessageForm — §17.4 / §30.1 / G024.
//
// User-initiated message signing surface. The user picks a chain +
// address from their wallet, types a message, enters their password,
// and gets back a signature they can copy. Signing routes through
// `messaging.signMessageRequest`, which the host implements via
// `flows.signMessageFlow`.
//
// The form is presentation-only — chain + address resolution comes
// from `messaging.getAddressesByChain` (already exposed for Send /
// Receive); the actual key handling stays inside the host. Hardware
// signers are NOT supported here yet; G024's HW counterpart lives in a
// separate FOLLOWUP and will route through the signer bridge.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Screen,
    Button,
    Input,
    ChainBadge,
    AddressText,
    ChainPicker,
    CopyButton,
    Icon,
    StatusMessage,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useFormDraft } from '../hooks/useFormDraft.js';
import { useSettings } from '../hooks/useSettings.js';
import pickerStyles from './WalletPicker.module.css';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 */
export function SignMessageForm({ walletId, onBack }) {
    const { messaging, shell } = useMessaging();
    const signerReady = useSignerReady(walletId);
    const { settings } = useSettings();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [chainId, setChainId] = useState(/** @type {string | null} */ (null));
    const [addressId, setAddressId] = useState(/** @type {string | null} */ (null));
    const [message, setMessage] = useState('');
    const [password, setPassword] = useState('');

    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [signature, setSignature] = useState(/** @type {string | null} */ (null));
    const [signedMessage, setSignedMessage] = useState('');
    const [signedAddress, setSignedAddress] = useState('');

    // §37 / G125 — form-draft persistence. Persists chain / address /
    // message; password stays in component state only.
    // Cluster P FOLLOWUP 6 — honor settings.privacy.formDraftTtlMs.
    const formDraftTtlMs = Number.isFinite(settings?.privacy?.formDraftTtlMs)
        ? Number(settings.privacy.formDraftTtlMs)
        : undefined;
    const draft = useFormDraft({ view: 'sign-message', walletId, ttlMs: formDraftTtlMs });
    const [draftPending, setDraftPending] = useState(() => draft.hasDraft());
    useEffect(() => {
        if (signature || !draftPending) return;
        draft.save({ chainId, addressId, message });
    }, [signature, draftPending, draft, chainId, addressId, message]);
    const restoreDraft = useCallback(() => {
        const v = draft.load();
        if (!v) { setDraftPending(false); return; }
        if (typeof v.chainId === 'string') setChainId(v.chainId);
        if (typeof v.addressId === 'string') setAddressId(v.addressId);
        if (typeof v.message === 'string') setMessage(v.message);
        setDraftPending(true);
    }, [draft]);
    const dismissDraft = useCallback(() => {
        draft.clear();
        setDraftPending(false);
    }, [draft]);

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain);
                const first = Object.keys(byChain)[0];
                if (!first) {
                    setLoadError(
                        'No addresses on any chain yet. Use Receive to generate one before signing.',
                    );
                    return;
                }
                setChainId(first);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    // Default to the newest address on the active chain whenever the
    // chain selector changes.
    useEffect(() => {
        if (!chainId || !addressesByChain) return;
        const addrs = addressesByChain[chainId] || [];
        if (addrs.length === 0) {
            setAddressId(null);
            return;
        }
        const sorted = [...addrs].sort((a, b) => {
            const ai = Number(a.derivationPath?.split('/')?.[5] ?? -1);
            const bi = Number(b.derivationPath?.split('/')?.[5] ?? -1);
            return bi - ai;
        });
        setAddressId(sorted[0].id);
    }, [chainId, addressesByChain]);

    const chainOptions = useMemo(() => {
        if (!addressesByChain) return [];
        return Object.keys(addressesByChain)
            .filter((id) => (addressesByChain[id] || []).length > 0)
            .map((id) => {
                const desc = chainRegistry.get(id);
                return { id, label: desc?.displayName || id };
            });
    }, [addressesByChain]);

    const addressOptions = useMemo(() => {
        if (!chainId || !addressesByChain) return [];
        return addressesByChain[chainId] || [];
    }, [chainId, addressesByChain]);

    const selectedAddress = useMemo(
        () => addressOptions.find((a) => a.id === addressId) || null,
        [addressOptions, addressId],
    );

    async function handleSubmit(event) {
        event.preventDefault();
        if (busy) return;
        setError(null);
        if (!chainId) { setError('Pick a chain.'); return; }
        if (!addressId) { setError('Pick an address.'); return; }
        if (message.length === 0) { setError('Type a message to sign.'); return; }
        if ((!signerReady && password.length === 0)) { setError('Enter your wallet password.'); return; }
        if (typeof messaging.signMessageRequest !== 'function') {
            setError('messaging.signMessageRequest is not available in this shell.');
            return;
        }
        setBusy(true);
        try {
            const result = await messaging.signMessageRequest({
                walletId,
                addressId,
                password,
                message,
            });
            setSignature(result?.signature || '');
            setSignedMessage(message);
            setSignedAddress(selectedAddress?.address || '');
            setPassword('');
            draft.clear();
            setDraftPending(false);
        } catch (err) {
            const msg = err?.name === 'InvalidPasswordError'
                ? 'Incorrect password.'
                : err?.message || 'Signing failed.';
            setError(msg);
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
            <span className={pickerStyles.title}>Sign message</span>
            <span style={{ width: 28 }} />
        </div>
    );

    if (loadError) {
        return (
            <Screen variant={variant} header={header}>
                <div role="alert" style={{ color: 'var(--xc-danger)', padding: 'var(--xc-space-3)' }}>
                    {loadError}
                </div>
            </Screen>
        );
    }

    if (signature !== null) {
        const body = (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--xc-space-3)' }}>
                <div>
                    <div style={{ color: 'var(--xc-text-muted)', fontSize: 'var(--xc-text-sm)', marginBottom: 4 }}>
                        Signed by
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <ChainBadge chainId={chainId || ''} />
                        <AddressText address={signedAddress} />
                    </div>
                </div>
                <div>
                    <div style={{ color: 'var(--xc-text-muted)', fontSize: 'var(--xc-text-sm)', marginBottom: 4 }}>
                        Message
                    </div>
                    <pre style={{
                        background: 'var(--xc-surface)',
                        border: '1px solid var(--xc-border)',
                        borderRadius: 'var(--xc-radius-md)',
                        padding: 'var(--xc-space-2)',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        fontSize: 'var(--xc-text-sm)',
                    }}>{signedMessage}</pre>
                </div>
                <div>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: 4,
                    }}>
                        <span style={{ color: 'var(--xc-text-muted)', fontSize: 'var(--xc-text-sm)' }}>
                            Signature
                        </span>
                        <CopyButton value={signature} label="Copy signature" />
                    </div>
                    <pre style={{
                        background: 'var(--xc-surface)',
                        border: '1px solid var(--xc-border)',
                        borderRadius: 'var(--xc-radius-md)',
                        padding: 'var(--xc-space-2)',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                        fontSize: 'var(--xc-text-xs)',
                        fontFamily: 'var(--xc-font-mono)',
                    }}>{signature}</pre>
                </div>
                <Button
                    variant="ghost"
                    block
                    onClick={() => {
                        setSignature(null);
                        setSignedMessage('');
                        setSignedAddress('');
                    }}
                >
                    Sign another message
                </Button>
            </div>
        );
        return (
            <Screen variant={variant} header={header}>
                {isFull ? <div className={styles.card}>{body}</div> : body}
            </Screen>
        );
    }

    const draftBanner = draft.hasDraft() && !draftPending && !signature ? (
        <StatusMessage
            variant="status"
            recovery={{ label: 'Restore', onAction: restoreDraft }}
        >
            You have an unfinished message draft.
            <button
                type="button"
                onClick={dismissDraft}
                aria-label="Discard saved draft"
                style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'inherit',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                    padding: 0,
                    marginInlineStart: 'var(--xc-space-2)',
                    fontSize: 'var(--xc-text-xs)',
                }}
            >
                Discard
            </button>
        </StatusMessage>
    ) : null;

    const formBody = (
        <form onSubmit={handleSubmit} noValidate>
            {draftBanner}
            <div style={{ marginBottom: 'var(--xc-space-3)' }}>
                <ChainPicker
                    chains={chainOptions}
                    selectedChainId={chainId}
                    onChange={setChainId}
                    label="Chain"
                />
            </div>
            <div style={{ marginBottom: 'var(--xc-space-3)' }}>
                <label
                    htmlFor="sign-message-address"
                    style={{
                        display: 'block',
                        color: 'var(--xc-text-muted)',
                        fontSize: 'var(--xc-text-sm)',
                        marginBottom: 4,
                    }}
                >
                    Address
                </label>
                <select
                    id="sign-message-address"
                    value={addressId || ''}
                    onChange={(e) => { setAddressId(e.target.value || null); if (error) setError(null); }}
                    aria-label="Address"
                    style={{
                        width: '100%',
                        background: 'var(--xc-bg)',
                        color: 'var(--xc-text)',
                        border: '1px solid var(--xc-border)',
                        borderRadius: 'var(--xc-radius-sm)',
                        padding: 'var(--xc-space-2)',
                        fontSize: 'var(--xc-text-sm)',
                    }}
                >
                    {addressOptions.map((a) => (
                        <option key={a.id} value={a.id}>{a.address}</option>
                    ))}
                </select>
            </div>
            <div style={{ marginBottom: 'var(--xc-space-3)' }}>
                <label
                    htmlFor="sign-message-text"
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
                    id="sign-message-text"
                    value={message}
                    onChange={(e) => { setMessage(e.target.value); if (error) setError(null); }}
                    placeholder="Type the message you want to sign…"
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
            {signerReady ? (
                <p style={{ margin: 'var(--xc-space-2) 0 0', display: 'flex', alignItems: 'center', gap: 'var(--xc-space-1)', fontSize: 'var(--xc-text-sm)', color: 'var(--xc-text-muted)' }}>
                    <span aria-hidden="true">🔓</span> Wallet unlocked — no password needed.
                </p>
            ) : (
                <Input
                    type="password"
                    label="Wallet password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); if (error) setError(null); }}
                    autoComplete="current-password"
                    error={error || undefined}
                />
            )}
            <Button
                type="submit"
                variant="primary"
                block
                loading={busy}
                disabled={busy || message.length === 0 || (!signerReady && password.length === 0) || !addressId}
            >
                Sign message
            </Button>
        </form>
    );

    return (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{formBody}</div> : formBody}
        </Screen>
    );
}
