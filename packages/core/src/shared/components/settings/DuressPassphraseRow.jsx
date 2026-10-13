// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// DuressPassphraseRow: §26.5 / G068 part 2 Safety panel row.
//
// Three states:
//
//   not configured   "Set duress passphrase" reveals an inline form.
//                    The user confirms the current wallet password and types
//                    a different candidate twice; on submit the passphrase is
//                    hashed with a fresh 16-byte salt and stored in
//                    localStorage. Plaintext is never persisted.
//
//   configured       "Configured. Disable". A single click wipes the
//                    stored hash. There is intentionally no "view"
//                    affordance; the passphrase cannot be recovered
//                    from storage.
//
//   error            `<StatusMessage variant="error">` (role="alert") with a
//                    one-click "Try again" recovery on storage-write failure.
//
// Setup verifies the current wallet password so a duress passphrase cannot
// equal it. Disable remains available to the unlocked session.

import { useRef, useState } from 'react';
import { Button, Input, StatusMessage } from '@xchain-wallet/core/ui';
import { useMessaging } from '../../useMessaging.js';
import {
    isDuressConfigured,
    setDuressPassphrase,
    clearDuressPassphrase,
} from '../../../flows/duressPassphrase.js';
import { ROW, ROW_HINT } from './_settingsPrimitives.jsx';

export function DuressPassphraseRow() {
    const { messaging } = useMessaging();
    const [configured, setConfigured] = useState(isDuressConfigured());
    const [showForm, setShowForm] = useState(false);
    const [currentPassword, setCurrentPassword] = useState('');
    const [pass, setPass] = useState('');
    const [confirm, setConfirm] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(/** @type {string | null} */ (null));
    // Operational failures are retryable with the same inputs. Validation and
    // an incorrect current password require an edit, so those leave retryRef
    // null and the alert renders without a misleading "Try again" button.
    const retryRef = useRef(/** @type {null | (() => void)} */ (null));

    async function attemptSet() {
        if (busy) return;
        setError(null);
        retryRef.current = null;
        if (currentPassword.length === 0) {
            setError('Enter your current wallet password.');
            return;
        }
        if (pass.length === 0) {
            setError('Pick a passphrase.');
            return;
        }
        if (pass !== confirm) {
            setError('Passphrases do not match.');
            return;
        }
        if (pass === currentPassword) {
            setError('Duress passphrase must differ from your wallet password.');
            return;
        }
        setBusy(true);
        try {
            await messaging.unlockWallet(currentPassword);
            setDuressPassphrase(pass);
            setConfigured(true);
            setShowForm(false);
            setCurrentPassword('');
            setPass('');
            setConfirm('');
        } catch (err) {
            if (err?.name === 'InvalidPasswordError') {
                setError('Current wallet password is incorrect.');
            } else {
                retryRef.current = attemptSet;
                setError(err?.message || 'Could not save the duress passphrase.');
            }
        } finally {
            setBusy(false);
        }
    }

    function handleSet(event) {
        event.preventDefault();
        attemptSet();
    }

    function handleClear() {
        clearDuressPassphrase();
        setConfigured(false);
    }

    const labelStyle = { color: 'var(--xc-text)', fontWeight: 500 };
    if (configured) {
        return (
            <div style={ROW}>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                    <span style={labelStyle}>Duress passphrase</span>
                    <span style={ROW_HINT}>
                        Configured. Entering this passphrase on the unlock screen will silently arm
                        panic mode while showing a normal-looking wrong-password message.
                    </span>
                </div>
                <Button type="button" size="sm" variant="ghost" icon={null} onClick={handleClear}>
                    Disable
                </Button>
            </div>
        );
    }

    if (showForm) {
        return (
            <form onSubmit={handleSet} style={{ ...ROW, flexDirection: 'column', alignItems: 'stretch' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--xc-space-1)' }}>
                    <span style={labelStyle}>Set duress passphrase</span>
                    <span style={ROW_HINT}>
                        Pick a passphrase that is NOT your real wallet password. Entering it on the
                        unlock screen will silently arm panic mode (24-hour signing freeze) and surface
                        the same UI a wrong password produces.
                    </span>
                </div>
                <Input
                    type="password"
                    enterKeyHint="next"
                    value={currentPassword}
                    onChange={(e) => { setCurrentPassword(e.target.value); if (error) setError(null); }}
                    placeholder="Current wallet password"
                    autoComplete="current-password"
                    aria-label="Current wallet password"
                />
                <Input
                    type="password"
                    enterKeyHint="next"
                    value={pass}
                    onChange={(e) => { setPass(e.target.value); if (error) setError(null); }}
                    placeholder="Duress passphrase"
                    autoComplete="new-password"
                    aria-label="Duress passphrase"
                />
                <Input
                    type="password"
                    enterKeyHint="done"
                    value={confirm}
                    onChange={(e) => { setConfirm(e.target.value); if (error) setError(null); }}
                    placeholder="Confirm passphrase"
                    autoComplete="new-password"
                    aria-label="Confirm duress passphrase"
                />
                {error ? (
                    <StatusMessage
                        variant="error"
                        recovery={retryRef.current ? { label: 'Try again', onAction: retryRef.current } : undefined}
                    >
                        {error}
                    </StatusMessage>
                ) : null}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--xc-space-2)' }}>
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        icon={null}
                        onClick={() => {
                            setShowForm(false);
                            setCurrentPassword('');
                            setPass('');
                            setConfirm('');
                            setError(null);
                        }}
                        disabled={busy}
                    >
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        size="sm"
                        icon={null}
                        disabled={busy || currentPassword.length === 0 || pass.length === 0 || confirm.length === 0}
                    >
                        {busy ? 'Verifying…' : 'Save'}
                    </Button>
                </div>
            </form>
        );
    }

    return (
        <div style={ROW}>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                <span style={labelStyle}>Duress passphrase</span>
                <span style={ROW_HINT}>
                    A second password that, if entered on the unlock screen, silently arms panic mode
                    (24-hour signing freeze) without giving the observer any visible cue.
                </span>
            </div>
            <Button type="button" size="sm" variant="ghost" icon={null} onClick={() => setShowForm(true)}>
                Set
            </Button>
        </div>
    );
}
