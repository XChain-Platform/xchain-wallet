// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { useProtectedScreen } from '../utils/screenGuard.js';
import { AddressText, Button, CopyButton, FormPage, Icon, Input, ListPage, Notice, PageHeader, Screen, SectionHeader, Textarea, useFormErrors } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useSettings } from '../hooks/useSettings.js';
import { configureClipboardAutoClear } from '../clipboard.js';
import { privateKeyWarning } from '../utils/securityMomentCopy.js';
import { useBackHandler } from '../../ui/backStack.js';
import styles from './ViewPrivateKey.module.css';
// The key page reuses Receive's QR layout.
import receiveStyles from './Receive.module.css';
import qrStyles from '../../ui/QrDisplay.module.css';

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
    // Desktop applies window content protection; web and extension install
    // no screen guard: a browser tab cannot stop a screenshot and must not
    // pretend to.
    useProtectedScreen();

    const { messaging, shell } = useMessaging();
    const { settings } = useSettings();
    const variant = screenVariantFor(shell);
    const [stage, setStage] = useState(
        /** @type {'warning' | 'submitting' | 'revealed'} */ ('warning'),
    );
    const [password, setPassword] = useState('');
    const [revealed, setRevealed] = useState(false);
    const [wif, setWif] = useState(/** @type {{ addressId: string, value: string } | null} */ (null));
    const formErrors = useFormErrors();
    const resetFormErrors = formErrors.reset;
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const exportRequestRef = useRef(0);
    const clipboardAutoClearSeconds = configureClipboardAutoClear(
        settings?.privacy?.clipboardAutoClearSeconds,
    );

    const sourceInfo = useMemo(() => classifySource(address), [address]);
    const currentWif = wif?.addressId === address.id ? wif.value : null;

    const clearSensitiveState = useCallback(() => {
        exportRequestRef.current += 1;
        setStage('warning');
        setPassword('');
        resetFormErrors();
        setRevealed(false);
        setWif(null);
    }, [resetFormErrors]);

    const leaveScreen = useCallback(() => {
        clearSensitiveState();
        onBack();
    }, [clearSensitiveState, onBack]);

    // Back from the key page leaves the screen (and wipes the key). While an
    // export is in flight or a password is typed, Back (and a native pause,
    // which runs every overlay handler) wipes the password and drops the
    // pending export, so a key that resolves after the app is hidden never
    // shows.
    const holdsSecret = stage === 'submitting' || password.length > 0;
    useBackHandler(stage === 'revealed' ? leaveScreen : (holdsSecret ? clearSensitiveState : undefined));

    // Window blur covers accidental exposure during screen sharing. Desktop
    // also reports native minimize and hide because Electron does not emit a
    // reliable DOM blur or visibility transition for those paths.
    // The key page has no Hide, so blur and the timeout wipe the key and
    // return to the warning form instead of covering the key.
    useEffect(() => {
        if (!revealed) return undefined;
        const handler = () => clearSensitiveState();
        window.addEventListener('blur', handler);
        window.addEventListener('xc:window-hidden', handler);
        return () => {
            window.removeEventListener('blur', handler);
            window.removeEventListener('xc:window-hidden', handler);
        };
    }, [revealed, clearSensitiveState]);

    // A reveal expires even when the window remains focused.
    useEffect(() => {
        if (!revealed) return undefined;
        const id = setTimeout(() => clearSensitiveState(), REVEAL_TIMEOUT_MS);
        return () => clearTimeout(id);
    }, [revealed, clearSensitiveState]);

    useEffect(() => {
        clearSensitiveState();
    }, [walletId, address.id, clearSensitiveState]);

    useEffect(() => {
        // Every xc:session-changed wipes the shown key, a plain status
        // refresh of the same unlocked session included: the event cannot
        // tell a refresh from a new session, and showing the key again only
        // costs the password. This also stops a key exported by an earlier
        // session from staying on screen after a lock cycle, and drops any
        // export still in flight.
        window.addEventListener('xc:session-changed', clearSensitiveState);
        return () => {
            window.removeEventListener('xc:session-changed', clearSensitiveState);
            exportRequestRef.current += 1;
        };
    }, [clearSensitiveState]);

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting') return;
        // An empty password marks the field rather than disabling the button.
        if (password.length === 0) {
            formErrors.validate({ 'view-key-password': 'Enter your wallet password.' });
            passwordRef.current?.focus();
            return;
        }
        const requestId = ++exportRequestRef.current;
        setStage('submitting');
        formErrors.reset();
        try {
            const res = await messaging.exportPrivateKey({
                walletId,
                password,
                addressId: address.id,
            });
            if (exportRequestRef.current !== requestId) return;
            setPassword('');
            setWif({ addressId: address.id, value: res.wif });
            // The key shows at once; the warning and the password are the
            // confirmation, so there is no second tap to reveal.
            setRevealed(true);
            setStage('revealed');
        } catch (err) {
            if (exportRequestRef.current !== requestId) return;
            const name = err?.name;
            if (name === 'WrongPasswordError' || name === 'InvalidPasswordError'
                || name === 'AeadAuthError') {
                formErrors.validate({ 'view-key-password': 'The wallet password is not right.' });
            } else if (name === 'NoKeyForAddressError') {
                formErrors.fail('This address has no exportable private key.');
            } else {
                formErrors.fail('Could not confirm the password or load this private key.');
            }
            setStage('warning');
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }

    // The key's QR fills its white box: a one-module quiet zone and a thin
    // pad instead of the four-module margin inside a padded frame.
    const [keyQr, setKeyQr] = useState(/** @type {string | null} */ (null));
    useEffect(() => {
        if (!currentWif) { setKeyQr(null); return undefined; }
        let cancelled = false;
        QRCode.toDataURL(currentWif, { errorCorrectionLevel: 'M', margin: 1, width: 512, color: { dark: '#000000', light: '#FFFFFF' } })
            .then((url) => { if (!cancelled) setKeyQr(url); })
            .catch(() => { if (!cancelled) setKeyQr(null); });
        return () => { cancelled = true; };
    }, [currentWif]);

    const header = (
        <PageHeader
            onBack={leaveScreen}
            title="Show Private Key"
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
                <SectionHeader title="Private key is on your hardware device" />
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
                    <Button variant="success" icon={<Icon.CheckIcon />} onClick={leaveScreen}>Close</Button>
                </div>
            </>,
        );
    }
    if (sourceInfo.kind === 'watch-only') {
        return wrap(
            <>
                <SectionHeader title="No private key for this address" />
                <p className={styles.paragraph}>
                    This is a watch-only address. The wallet only observes it; no
                    private key is stored here and nothing can be signed from it.
                </p>
                <div className={styles.actions}>
                    <Button variant="success" icon={<Icon.CheckIcon />} onClick={leaveScreen}>Close</Button>
                </div>
            </>,
        );
    }

    // One form stays mounted through password confirmation and reveal. The
    // private key and its QR have no DOM representation until export succeeds.
    return wrap(
        <FormPage
            label="Before you continue"
            onSubmit={handleSubmit}
            errors={formErrors}
            actions={stage !== 'revealed' ? (
                <Button
                    type="submit"
                    variant="success"
                    icon={<Icon.ThumbsUpIcon />}
                    loading={stage === 'submitting'}
                    disabled={stage === 'submitting'}
                >
                    I Understand
                </Button>
            ) : null}
        >
            <div className={`${qrStyles.stack} ${receiveStyles.receiveQrDisplay} ${styles.keyStack}`}>
                {/* The security notice always leads the page. */}
                <Notice tone="danger" role="note" data-warning-line="critical">
                    <p>{privateKeyWarning()}</p>
                </Notice>
                {/* A successful export adds the QR directly below the notice. */}
                {stage === 'revealed' && keyQr ? (
                    <div className={qrStyles.frame} style={{ '--xc-qr-frame-size': '224px', padding: 'var(--xc-space-1)' }}>
                        <img src={keyQr} alt="Private key QR code" width={512} height={512} style={{ display: 'block', width: '100%', height: 'auto', aspectRatio: '1 / 1' }} />
                    </div>
                ) : null}
                {/* The same read-only address field remains in place in both states. */}
                <Input label="Address" help="The address this key controls. Anyone holding the key can spend what this address holds." value={address.address} readOnly autoComplete="off" onChange={() => {}} fieldAction={<CopyButton value={address.address} label="Copy Address" ariaLabel="Copy Address" iconOnly />} />
                {stage === 'revealed' ? (
                    <>
                        <Textarea label="Private key" value={currentWif ?? ''} rows={2} readOnly autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} onChange={() => {}} style={{ resize: 'none' }} fieldAction={currentWif ? <CopyButton value={currentWif} label="Copy Private Key" ariaLabel="Copy Private Key" sensitive iconOnly onCopied={() => {}} /> : null} />
                        <span className={styles.clipboardNote}>
                            {clipboardAutoClearSeconds === 0
                                ? 'Sensitive clipboard copies remain until replaced.'
                                : `Sensitive clipboard copies expire after ${clipboardAutoClearSeconds} seconds.`}
                        </span>
                    </>
                ) : (
                    <Input
                        id="view-key-password"
                        ref={passwordRef}
                        type="password"
                        label="Wallet password"
                        help="The password that unlocks this wallet on this device. The private key shows only after it is confirmed."
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        autoComplete="current-password"
                        disabled={stage === 'submitting'}
                    />
                )}
            </div>
        </FormPage>,
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
