// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Screen,
    Button,
    Input,
    AddressText,
    ChainBadge,
 Icon,} from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
} from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useSettings } from '../hooks/useSettings.js';
import { CLIPBOARD_AUTO_CLEAR_DEFAULT } from '../../schemas/settings.js';
import styles from './ViewPrivateKey.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * ViewPrivateKey — §17.7. Shows the WIF for an address the wallet
 * owns, with the full security ceremony: password re-entry even
 * inside an unlocked session (§17.7.3), tap-to-reveal, automatic
 * hide on window blur, and a Copy button that auto-clears the
 * clipboard after 60 seconds.
 *
 * HW-wallet + watch-only addresses route to an informational panel
 * per §17.7.2 — no password prompt, no fake reveal. Protocol-level
 * refusal is the `exportPrivateKey` flow's job; this component
 * short-circuits the UX so users don't even type a password to be
 * told "no."
 *
 * QR rendering lives in the shell: the component accepts a
 * `renderQR({ value })` render-prop. Extension + web both pass a
 * `qrcode`-backed renderer; desktop can reuse that.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {{ id: string, address: string, source: string, chain: string, network: string, derivationPath: string | null, label: string }} props.address
 * @param {(args: { value: string }) => import('react').ReactNode} [props.renderQR]
 * @param {() => void} props.onBack
 */
export function ViewPrivateKey({ walletId, address, renderQR, onBack }) {
    const { messaging, shell } = useMessaging();
    const { settings } = useSettings();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';
    // §17.7.1 / G028 — clipboard auto-clear timeout, configurable from
    // Settings → Privacy. 0 disables the auto-clear. Records without
    // the field (older v2 settings) fall back to the spec default.
    const clipboardAutoClearSeconds = (() => {
        const raw = settings?.privacy?.clipboardAutoClearSeconds;
        if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) return raw;
        return CLIPBOARD_AUTO_CLEAR_DEFAULT;
    })();

    const [stage, setStage] = useState(
        /** @type {'warning' | 'password' | 'submitting' | 'revealed'} */ ('warning'),
    );
    const [password, setPassword] = useState('');
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [revealed, setRevealed] = useState(false);
    const [wif, setWif] = useState(/** @type {string | null} */ (null));
    const [clipboardStatus, setClipboardStatus] = useState(
        /** @type {'idle' | 'copied' | 'cleared'} */ ('idle'),
    );
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    const sourceInfo = useMemo(() => classifySource(address), [address]);

    useEffect(() => {
        if (stage === 'password') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    // §17.7.1 — auto-hide on window blur. Wipes the revealed flag
    // but keeps the WIF in closure so the reveal button can bring
    // it back without re-entering the password within the session.
    useEffect(() => {
        const handler = () => setRevealed(false);
        window.addEventListener('blur', handler);
        return () => window.removeEventListener('blur', handler);
    }, []);

    // §17.7.1 / G028 — clipboard auto-clear. Timeout sourced from
    // settings.privacy.clipboardAutoClearSeconds (0–600, 0 disables).
    useEffect(() => {
        if (clipboardStatus !== 'copied') return undefined;
        if (clipboardAutoClearSeconds <= 0) return undefined;
        const id = setTimeout(() => {
            navigator.clipboard?.writeText('').catch(() => {});
            setClipboardStatus('cleared');
        }, clipboardAutoClearSeconds * 1000);
        return () => clearTimeout(id);
    }, [clipboardStatus, clipboardAutoClearSeconds]);

    const chainId = useMemo(() => {
        const descriptor = findDescriptor(address);
        return descriptor?.chainId || null;
    }, [address]);
    const descriptor = chainId ? chainRegistry.get(chainId) : null;

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting' || password.length === 0) return;
        setStage('submitting');
        setSubmitError(null);
        try {
            const res = await messaging.exportPrivateKey({
                walletId,
                password,
                addressId: address.id,
            });
            setWif(res.wif);
            setRevealed(true);
            setStage('revealed');
        } catch (err) {
            const name = err?.name;
            if (name === 'WrongPasswordError' || name === 'InvalidPasswordError') {
                setSubmitError('Incorrect password.');
            } else if (name === 'NoKeyForAddressError') {
                // The core flow's authoritative refusal. Shouldn't hit
                // for HW/watch-only since we route those to the info
                // panel — this fires if classifySource is wrong.
                setSubmitError('This address has no exportable private key.');
            } else {
                setSubmitError(err?.message || 'Export failed.');
            }
            setStage('password');
            passwordRef.current?.focus();
            passwordRef.current?.select();
        }
    }

    async function handleCopy() {
        if (!wif) return;
        try {
            await navigator.clipboard?.writeText(wif);
            setClipboardStatus('copied');
        } catch {
            setClipboardStatus('idle');
        }
    }

        const header = (
        <ScreenHeader
            onBack={onBack}
            title="Show private key"
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    // HW / watch-only: informational panel; no reveal path.
    if (sourceInfo.kind === 'hardware') {
        return wrap(
            <>
                <h2 className={styles.infoTitle}>Private key is on your hardware device</h2>
                <p className={styles.paragraph}>
                    The private key for this address lives on your {sourceInfo.deviceLabel}.
                    The wallet never sees or stores it.
                </p>
                <p className={styles.paragraph}>
                    To recover this key, use your {sourceInfo.deviceLabel}'s own recovery
                    tools (seed phrase, recovery card, or vendor recovery app).
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Address</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={address.address} />
                    </dd>
                </dl>
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Close</Button>
                </div>
            </>,
        );
    }
    if (sourceInfo.kind === 'watch-only') {
        return wrap(
            <>
                <h2 className={styles.infoTitle}>No private key for this address</h2>
                <p className={styles.paragraph}>
                    This is a watch-only address. The wallet only observes it — no
                    private key is stored here and nothing can be signed from it.
                </p>
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Close</Button>
                </div>
            </>,
        );
    }

    if (stage === 'warning') {
        return wrap(
            <>
                <h2 className={styles.warningTitle}>Before you continue</h2>
                <ul className={styles.warningList}>
                    <li>
                        This is the private key for
                        {' '}<AddressText address={address.address} />.
                        Anyone with it can spend from this address.
                    </li>
                    <li>Do not share it with anyone — including XChain support.</li>
                    <li>
                        If you are screen-sharing or recording, <strong>cancel that now</strong>{' '}
                        before you reveal the key.
                    </li>
                    {sourceInfo.kind === 'hd' ? (
                        <li>
                            This key is derived from your seed phrase. If you have your
                            seed phrase backed up, you don't need to back up this key
                            separately.
                        </li>
                    ) : (
                        <li>
                            This key was imported separately. It is included in encrypted
                            backups but is <strong>not</strong> recoverable from your seed phrase.
                        </li>
                    )}
                </ul>
                <div className={styles.actions}>
                    <Button variant="primary" onClick={() => setStage('password')}>
                        I understand — continue
                    </Button>
                </div>
            </>,
        );
    }

    if (stage === 'password' || stage === 'submitting') {
        return wrap(
            <form onSubmit={handleSubmit} noValidate>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : address.chain}
                    </dd>
                    <dt className={styles.detailsLabel}>Address</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={address.address} />
                    </dd>
                </dl>
                <Input
                    ref={passwordRef}
                    type="password"
                    label="Password"
                    hint="Required every time — even when the wallet is already unlocked."
                    value={password}
                    onChange={(e) => {
                        setPassword(e.target.value);
                        if (submitError) setSubmitError(null);
                    }}
                    autoComplete="current-password"
                    disabled={stage === 'submitting'}
                    error={submitError || undefined}
                />
                <div className={styles.actions}>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={stage === 'submitting'}
                        disabled={password.length === 0}
                    >
                        Reveal
                    </Button>
                </div>
            </form>,
        );
    }

    // stage === 'revealed'
    return wrap(
        <>
            <dl className={styles.detailsList}>
                <dt className={styles.detailsLabel}>Address</dt>
                <dd className={styles.detailsValue}>
                    <AddressText address={address.address} />
                </dd>
                {address.derivationPath ? (
                    <>
                        <dt className={styles.detailsLabel}>Path</dt>
                        <dd className={styles.detailsValue}>
                            <code className={styles.code}>{address.derivationPath}</code>
                        </dd>
                    </>
                ) : null}
            </dl>
            <div className={styles.revealRow}>
                {revealed ? (
                    <code className={styles.wif}>{wif}</code>
                ) : (
                    <button
                        type="button"
                        className={styles.revealButton}
                        onClick={() => setRevealed(true)}
                    >
                        Tap to reveal private key
                    </button>
                )}
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRevealed(false)}
                    disabled={!revealed}
                >
                    Hide
                </Button>
            </div>
            {revealed && renderQR && wif ? (
                <div className={styles.qrRow}>
                    {renderQR({ value: wif })}
                </div>
            ) : null}
            <div className={styles.copyRow}>
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleCopy}
                    disabled={!revealed}
                >
                    {clipboardStatus === 'copied'
                        ? (clipboardAutoClearSeconds > 0
                            ? `Copied — auto-clears in ${clipboardAutoClearSeconds}s`
                            : 'Copied')
                        : 'Copy'}
                </Button>
                {clipboardStatus === 'cleared' ? (
                    <span className={styles.clipboardNote}>Clipboard cleared.</span>
                ) : null}
            </div>
            <div className={styles.actions}>
                <Button variant="primary" onClick={onBack}>Done</Button>
            </div>
        </>,
    );
}

/**
 * Decide how to route an address: `hd` / `imported-wif` have an
 * exportable key; `trezor` / `ledger` route to the "lives on device"
 * panel; `watch-only` to the "no key here" panel. `source` is the
 * `Address.source` value.
 *
 * @param {{ source: string }} address
 */
function classifySource(address) {
    switch (address.source) {
        case 'hd': return { kind: 'hd' };
        case 'imported-wif': return { kind: 'imported' };
        case 'trezor': return { kind: 'hardware', deviceLabel: 'Trezor' };
        case 'ledger': return { kind: 'hardware', deviceLabel: 'Ledger' };
        case 'watch-only': return { kind: 'watch-only' };
        default: return { kind: 'hd' };
    }
}

function findDescriptor(address) {
    for (const descriptor of chainRegistry.all()) {
        if (descriptor.coin === address.chain && descriptor.networkKind === address.network) {
            return descriptor;
        }
    }
    return null;
}
