// BiometricRow — §35 Safety panel row that owns the §26 / G063 biometric
// unlock affordance. Three states:
//
//   not-supported    Platform authenticator absent / WebAuthn missing.
//                    Renders a status line and disables interaction.
//   supported-off    No credential registered. Reveals an inline password
//                    field; on submit, runs `registerBiometricCredential`
//                    so the wallet password is wrapped under the PRF
//                    output of the new credential.
//   supported-on     Credential registered. Shows a Disable button that
//                    wipes the credential reference + ciphertext from
//                    localStorage. (The platform credential itself can
//                    only be cleared via OS settings — by design.)
//
// The component re-checks support + registration on mount and after any
// state change so toggling between OS settings + the wallet stays in
// sync without a refresh.

import { useEffect, useState } from 'react';
import {
    isBiometricSupported,
    isBiometricRegistered,
    clearBiometricCredential,
    registerBiometricCredential,
} from '../../../flows/biometricUnlock.js';
import { ROW, ROW_HINT } from './_settingsPrimitives.jsx';

export function BiometricRow() {
    const [supported, setSupported] = useState(/** @type {boolean | null} */ (null));
    const [registered, setRegistered] = useState(isBiometricRegistered());
    const [showEnableForm, setShowEnableForm] = useState(false);
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(/** @type {string | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        isBiometricSupported().then((ok) => {
            if (!cancelled) setSupported(Boolean(ok));
        });
        return () => { cancelled = true; };
    }, []);

    const refreshRegistered = () => setRegistered(isBiometricRegistered());

    async function handleEnable(event) {
        event.preventDefault();
        if (busy || password.length === 0) return;
        setBusy(true);
        setError(null);
        try {
            await registerBiometricCredential({ password });
            setPassword('');
            setShowEnableForm(false);
            refreshRegistered();
        } catch (err) {
            setError(err?.message || 'Enabling biometric unlock failed.');
        } finally {
            setBusy(false);
        }
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

    if (supported === null) {
        return (
            <div style={ROW}>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                    <span style={labelStyle}>Biometric unlock</span>
                    <span style={ROW_HINT}>Checking platform authenticator…</span>
                </div>
            </div>
        );
    }

    if (!supported) {
        return (
            <div style={ROW}>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                    <span style={labelStyle}>Biometric unlock</span>
                    <span style={ROW_HINT}>
                        Not available — this device or browser doesn&rsquo;t expose a
                        WebAuthn platform authenticator with PRF support.
                    </span>
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
                        Enabled. Use Touch ID / Windows Hello / device biometric on the unlock screen.
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
                        Confirm your wallet password. The password is wrapped under your
                        platform authenticator&rsquo;s PRF output and never persisted in plaintext.
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
                    <span style={{ color: 'var(--xc-danger)', fontSize: 'var(--xc-text-xs)' }} role="alert">
                        {error}
                    </span>
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
                    Use Touch ID, Windows Hello, or your device biometric to unlock without typing your password.
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
