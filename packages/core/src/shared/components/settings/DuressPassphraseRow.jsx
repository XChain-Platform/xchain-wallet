// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// DuressPassphraseRow — §26.5 / G068 part 2 Safety panel row.
//
// Three states:
//
//   not configured   "Set duress passphrase" reveals an inline form.
//                    The user types a candidate twice; on submit the
//                    passphrase is hashed with a fresh 16-byte salt
//                    and stored in localStorage. Plaintext is never
//                    persisted.
//
//   configured       "Configured. Disable" — a single click wipes the
//                    stored hash. There is intentionally no "view"
//                    affordance; the passphrase cannot be recovered
//                    from storage.
//
//   error            Inline `role="alert"` text with retry hint.
//
// The row deliberately doesn't ask for the wallet password to enable
// or disable the duress passphrase. Anyone with the wallet open is
// already trusted enough to lock it; rotating the duress passphrase
// is a routine operation, not a privileged one.

import { useState } from 'react';
import {
    isDuressConfigured,
    setDuressPassphrase,
    clearDuressPassphrase,
} from '../../../flows/duressPassphrase.js';
import { ROW, ROW_HINT } from './_settingsPrimitives.jsx';

export function DuressPassphraseRow() {
    const [configured, setConfigured] = useState(isDuressConfigured());
    const [showForm, setShowForm] = useState(false);
    const [pass, setPass] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState(/** @type {string | null} */ (null));

    function handleSet(event) {
        event.preventDefault();
        setError(null);
        if (pass.length === 0) {
            setError('Pick a passphrase.');
            return;
        }
        if (pass !== confirm) {
            setError('Passphrases do not match.');
            return;
        }
        try {
            setDuressPassphrase(pass);
            setConfigured(true);
            setShowForm(false);
            setPass('');
            setConfirm('');
        } catch (err) {
            setError(err?.message || 'Could not save the duress passphrase.');
        }
    }

    function handleClear() {
        clearDuressPassphrase();
        setConfigured(false);
    }

    const labelStyle = { color: 'var(--xc-text)', fontWeight: 500 };
    const buttonStyle = {
        background: 'var(--xc-surface-raised)',
        color: 'var(--xc-text)',
        border: '1px solid var(--xc-border-strong)',
        borderRadius: 'var(--xc-radius-sm)',
        padding: 'var(--xc-space-1) var(--xc-space-3)',
        fontSize: 'var(--xc-text-sm)',
        cursor: 'pointer',
    };
    const inputStyle = {
        background: 'var(--xc-bg)',
        color: 'var(--xc-text)',
        border: '1px solid var(--xc-border)',
        borderRadius: 'var(--xc-radius-sm)',
        padding: 'var(--xc-space-2)',
        fontSize: 'var(--xc-text-sm)',
    };

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
                <button type="button" onClick={handleClear} style={buttonStyle}>
                    Disable
                </button>
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
                <input
                    type="password"
                    value={pass}
                    onChange={(e) => { setPass(e.target.value); if (error) setError(null); }}
                    placeholder="Duress passphrase"
                    autoComplete="new-password"
                    aria-label="Duress passphrase"
                    style={inputStyle}
                />
                <input
                    type="password"
                    value={confirm}
                    onChange={(e) => { setConfirm(e.target.value); if (error) setError(null); }}
                    placeholder="Confirm passphrase"
                    autoComplete="new-password"
                    aria-label="Confirm duress passphrase"
                    style={inputStyle}
                />
                {error ? (
                    <span style={{ color: 'var(--xc-danger)', fontSize: 'var(--xc-text-xs)' }} role="alert">
                        {error}
                    </span>
                ) : null}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--xc-space-2)' }}>
                    <button
                        type="button"
                        onClick={() => { setShowForm(false); setPass(''); setConfirm(''); setError(null); }}
                        style={buttonStyle}
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        style={{ ...buttonStyle, fontWeight: 600 }}
                        disabled={pass.length === 0 || confirm.length === 0}
                    >
                        Save
                    </button>
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
            <button type="button" onClick={() => setShowForm(true)} style={buttonStyle}>
                Set
            </button>
        </div>
    );
}
