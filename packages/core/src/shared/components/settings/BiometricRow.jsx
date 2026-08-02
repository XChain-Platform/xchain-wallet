// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// BiometricRow (§35): Safety panel row that owns the §26 / G063 biometric
// unlock affordance. Three states:
//
//   not-supported    Nothing on this device can release the password.
//                    Renders the provider's own reason and disables
//                    interaction.
//   supported-off    No credential registered. Reveals an inline password
//                    field; on submit, runs `registerBiometricCredential`
//                    so the wallet password is wrapped by whatever the
//                    active provider wraps it with.
//   supported-on     Credential registered. Shows a Disable button that
//                    discards the wrap. (The platform credential itself can
//                    only be cleared via OS settings, by design.)
//
// This component names NO vendor and NO browser API, and a smoke test
// enforces that . It used to hardcode two desktop-platform brand
// names and explain unavailability in terms of the browser credential API,
// which on a phone is wrong twice over: neither brand is what the device
// does, and the true reason there is usually "nothing is enrolled yet" - a
// reason the native provider already had and this row discarded. All such
// wording now comes from `describeBiometric()`, so adding a third shell means
// teaching its provider to speak, not editing shared UI.
//
// The component re-checks support + registration on mount and after any
// state change so toggling between OS settings + the wallet stays in
// sync without a refresh.

import { useEffect, useRef, useState } from 'react';
import { StatusMessage } from '@xchain-wallet/core/ui';
import {
    describeBiometric,
    isBiometricRegistered,
    clearBiometricCredential,
    registerBiometricCredential,
} from '../../../flows/biometricUnlock.js';
import { ROW, ROW_HINT } from './_settingsPrimitives.jsx';

export function BiometricRow() {
    // null while the probe is in flight; afterwards the provider's full
    // self-description, which is where every user-facing noun below comes from.
    const [description, setDescription] = useState(
        /** @type {null | Awaited<ReturnType<typeof describeBiometric>>} */ (null),
    );
    const [registered, setRegistered] = useState(isBiometricRegistered());
    const [showEnableForm, setShowEnableForm] = useState(false);
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(/** @type {string | null} */ (null));
    // : re-run the pairing attempt on the recorded action. Biometric
    // registration failures (prompt timeout, user-cancelled the OS dialog,
    // transient provider error) are always retryable with the same password
    // still in the field, so the error surface offers a one-click "Try again".
    const retryRef = useRef(/** @type {null | (() => void)} */ (null));

    useEffect(() => {
        let cancelled = false;
        describeBiometric().then((described) => {
            if (!cancelled) setDescription(described);
        });
        return () => { cancelled = true; };
    }, []);

    const refreshRegistered = () => setRegistered(isBiometricRegistered());

    async function doEnable() {
        if (busy || password.length === 0) return;
        setBusy(true);
        setError(null);
        retryRef.current = null;
        try {
            await registerBiometricCredential({ password });
            setPassword('');
            setShowEnableForm(false);
            refreshRegistered();
        } catch (err) {
            retryRef.current = doEnable;
            setError(err?.message || 'Enabling biometric unlock failed.');
        } finally {
            setBusy(false);
        }
    }

    function handleEnable(event) {
        event.preventDefault();
        doEnable();
    }

    function handleDisable() {
        clearBiometricCredential();
        refreshRegistered();
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

    if (description === null) {
        return (
            <div style={ROW}>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                    <span style={labelStyle}>Biometric unlock</span>
                    <span style={ROW_HINT}>Checking this device…</span>
                </div>
            </div>
        );
    }

    if (!description.supported) {
        return (
            <div style={ROW}>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                    <span style={labelStyle}>Biometric unlock</span>
                    <span style={ROW_HINT}>Not available. {description.reason}</span>
                </div>
            </div>
        );
    }

    if (registered) {
        return (
            <div style={ROW}>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                    <span style={labelStyle}>Biometric unlock</span>
                    <span style={ROW_HINT}>
                        Enabled. Use {description.mechanism} on the unlock screen.
                    </span>
                </div>
                <button type="button" onClick={handleDisable} style={buttonStyle}>
                    Disable
                </button>
            </div>
        );
    }

    if (showEnableForm) {
        return (
            <form onSubmit={handleEnable} style={{ ...ROW, flexDirection: 'column', alignItems: 'stretch' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--xc-space-1)' }}>
                    <span style={labelStyle}>Enable biometric unlock</span>
                    <span style={ROW_HINT}>
                        Confirm your wallet password. {description.wrapNote}
                    </span>
                </div>
                <input
                    type="password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); if (error) setError(null); }}
                    placeholder="Wallet password"
                    autoComplete="current-password"
                    aria-label="Wallet password"
                    style={{
                        background: 'var(--xc-bg)',
                        color: 'var(--xc-text)',
                        border: '1px solid var(--xc-border)',
                        borderRadius: 'var(--xc-radius-sm)',
                        padding: 'var(--xc-space-2)',
                        fontSize: 'var(--xc-text-sm)',
                    }}
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
                    <button
                        type="button"
                        onClick={() => { setShowEnableForm(false); setPassword(''); setError(null); }}
                        style={buttonStyle}
                        disabled={busy}
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        style={{ ...buttonStyle, fontWeight: 600 }}
                        disabled={busy || password.length === 0}
                    >
                        {busy ? 'Pairing…' : 'Confirm'}
                    </button>
                </div>
            </form>
        );
    }

    return (
        <div style={ROW}>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                <span style={labelStyle}>Biometric unlock</span>
                <span style={ROW_HINT}>
                    Use {description.mechanism} to unlock without typing your password.
                </span>
            </div>
            <button
                type="button"
                onClick={() => setShowEnableForm(true)}
                style={buttonStyle}
            >
                Enable
            </button>
        </div>
    );
}
