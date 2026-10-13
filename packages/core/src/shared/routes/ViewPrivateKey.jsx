// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useProtectedScreen } from '../utils/screenGuard.js';
import { AddressText, Button, CopyButton, Icon, Input, ListPage, PageHeader, Screen } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useSettings } from '../hooks/useSettings.js';
import { configureClipboardAutoClear } from '../clipboard.js';
import { PRIVATE_KEY_WARNING } from '../utils/securityMomentCopy.js';
import styles from './ViewPrivateKey.module.css';

const REVEAL_TIMEOUT_MS = 30_000;

/**
 * ViewPrivateKey: §17.7. Shows the WIF for an address the wallet owns.
 * Reveal requires the wallet password, an explicit tap after confirmation,
 * and automatic hiding on timeout or window blur. Sensitive copies use the
 * guarded clipboard path and the wallet's selected expiry.
 *
 * HW-wallet + watch-only addresses route to an informational panel
 * per §17.7.2: no reveal path. Protocol-level refusal is the
 * `exportPrivateKey` flow's job; this component short-circuits the UX.
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
    // S4: A private key on screen is the wallet. FLAG_SECURE also keeps this
    // window out of the recents thumbnail, which Android writes to disk.
    // No-op on every shell that installs no screen guard (web, extension,
    // desktop): a browser tab cannot stop a screenshot and must not pretend to.
    useProtectedScreen();

    const { messaging, shell } = useMessaging();
    const { settings } = useSettings();
    const variant = screenVariantFor(shell);
    const [stage, setStage] = useState(
        /** @type {'warning' | 'password' | 'submitting' | 'revealed'} */ ('warning'),
    );
    const [password, setPassword] = useState('');
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [revealed, setRevealed] = useState(false);
    const [wif, setWif] = useState(
        /** @type {{ walletId: string, addressId: string, value: string } | null} */ (null),
    );
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const exportAttemptRef = useRef(0);
    const clipboardAutoClearSeconds = configureClipboardAutoClear(
        settings?.privacy?.clipboardAutoClearSeconds,
    );

    const sourceInfo = useMemo(() => classifySource(address), [address]);
    const currentWif = wif?.walletId === walletId && wif?.addressId === address.id
        ? wif.value
        : null;

    useEffect(() => {
        if (stage !== 'password') return undefined;
        const id = setTimeout(() => passwordRef.current?.focus(), 0);
        return () => clearTimeout(id);
    }, [stage]);

    // Window blur covers accidental exposure during screen sharing.
    useEffect(() => {
        const handler = () => setRevealed(false);
        window.addEventListener('blur', handler);
        return () => window.removeEventListener('blur', handler);
    }, []);

    // A reveal expires even when the window remains focused.
    useEffect(() => {
        if (!revealed) return undefined;
        const id = setTimeout(() => setRevealed(false), REVEAL_TIMEOUT_MS);
        return () => clearTimeout(id);
    }, [revealed]);

    useEffect(() => {
        exportAttemptRef.current += 1;
        setStage('warning');
        setPassword('');
        setSubmitError(null);
        setRevealed(false);
        setWif(null);
        return () => { exportAttemptRef.current += 1; };
    }, [walletId, address.id]);

    function handleBack() {
        exportAttemptRef.current += 1;
        setStage('warning');
        setPassword('');
        setSubmitError(null);
        setRevealed(false);
        setWif(null);
        onBack();
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting' || password.length === 0) return;
        const attempt = ++exportAttemptRef.current;
        setStage('submitting');
        setSubmitError(null);
        try {
            const res = await messaging.exportPrivateKey({
                walletId,
                password,
                addressId: address.id,
            });
            if (attempt !== exportAttemptRef.current) return;
            setPassword('');
            setWif({ walletId, addressId: address.id, value: res.wif });
            setRevealed(false);
            setStage('revealed');
        } catch (err) {
            if (attempt !== exportAttemptRef.current) return;
            const name = err?.name;
            if (name === 'WrongPasswordError' || name === 'InvalidPasswordError'
                || name === 'AeadAuthError') {
                setSubmitError('Incorrect password. Try again.');
            } else if (name === 'NoKeyForAddressError') {
                setSubmitError('This address has no exportable private key.');
            } else {
                setSubmitError('Could not confirm the password or load this private key.');
            }
            setStage('password');
        }
    }

    const header = (
        <PageHeader
            onBack={handleBack}
            title="Show private key"
            titleIcon={<Icon.LockIcon />}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            <ListPage>{children}</ListPage>
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
                    tools (recovery phrase, recovery card, or vendor recovery app).
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Address</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={address.address} />
                    </dd>
                </dl>
                <div className={styles.actions}>
                    <Button variant="primary" onClick={handleBack}>Close</Button>
                </div>
            </>,
        );
    }
    if (sourceInfo.kind === 'watch-only') {
        return wrap(
            <>
                <h2 className={styles.infoTitle}>No private key for this address</h2>
                <p className={styles.paragraph}>
                    This is a watch-only address. The wallet only observes it; no
                    private key is stored here and nothing can be signed from it.
                </p>
                <div className={styles.actions}>
                    <Button variant="primary" onClick={handleBack}>Close</Button>
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
                    </li>
                    <li>{PRIVATE_KEY_WARNING}</li>
                    <li>
                        If you are screen-sharing or recording, <strong>stop now</strong>{' '}
                        before you reveal the key.
                    </li>
                    {sourceInfo.kind === 'hd' ? (
                        <li>
                            This key is derived from your recovery phrase. If you have your
                            recovery phrase backed up, you don't need to back up this key
                            separately.
                        </li>
                    ) : (
                        <li>
                            This key was imported separately. It is included in encrypted
                            backups but is <strong>not</strong> recoverable from your recovery phrase.
                        </li>
                    )}
                </ul>
                <div className={styles.actions}>
                    <Button
                        variant="primary"
                        onClick={() => setStage('password')}
                    >
                        I understand, continue
                    </Button>
                </div>
            </>,
        );
    }

    if (stage === 'password' || stage === 'submitting') {
        return wrap(
            <form onSubmit={handleSubmit} noValidate>
                <p className={styles.paragraph}>
                    Confirm your wallet password. The key stays hidden until you tap to reveal it.
                </p>
                <Input
                    ref={passwordRef}
                    type="password"
                    label="Wallet password"
                    hint="Required every time you view a private key."
                    value={password}
                    onChange={(event) => {
                        setPassword(event.target.value);
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
                        disabled={stage === 'submitting' || password.length === 0}
                    >
                        Confirm password
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
                    <code className={styles.wif}>{currentWif}</code>
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
            {revealed && renderQR && currentWif ? (
                <div className={styles.qrRow}>
                    {renderQR({ value: currentWif })}
                </div>
            ) : null}
            <div className={styles.copyRow}>
                {revealed && currentWif ? (
                    <CopyButton
                        value={currentWif}
                        label="Copy private key"
                        sensitive
                        onCopied={() => {}}
                    />
                ) : null}
                <span className={styles.clipboardNote}>
                    {clipboardAutoClearSeconds === 0
                        ? 'Sensitive clipboard copies remain until replaced.'
                        : `Sensitive clipboard copies expire after ${clipboardAutoClearSeconds} seconds.`}
                </span>
            </div>
            <div className={styles.actions}>
                <Button variant="primary" onClick={handleBack}>Done</Button>
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
