// DeveloperModeSection — §35.1 + §48 Developer Mode panel.
//
// Live:
//   - Developer Mode master toggle (`settings.developerMode`). Gates
//     regtest visibility in chain pickers (currently applied in
//     NetworkEndpointsSection; broader picker application lands in a
//     follow-up step).
//   - Learn Mode toggle (`settings.learnMode`). Drives explanatory
//     copy on confirmation screens; toggle ships now even though some
//     consumers haven't been wired yet.
//   - Auto-approve localhost dApps (`settings.autoApproveLocalhost`).
//     §48.6 / G151 — when both this and Developer Mode are on,
//     `bridge.connect` from localhost / 127.0.0.1 / [::1] origins
//     skips the approval prompt. Sign requests still prompt (the
//     password is required to sign and the wallet never caches it).
//   - Regtest networks subsection (§48.3 / G149). Lists the bundled
//     regtest descriptors and lets the user activate one at runtime
//     via `messaging.activateChainRequest`. Idempotent re-activation
//     is a no-op.
//
// Deferred (need new schema fields + flow wiring):
//   - Custom chain registry (§9.7 user-added chains via
//     `chainRegistry.addCustom`; UI to add a chain descriptor)
//   - Raw PSBT inspector reveal on sign screens (§48.4)
//   - Logs and diagnostics console (§48.5)

import { useEffect, useState } from 'react';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging } from '../../useMessaging.js';
import { useSettings } from '../../hooks/useSettings.js';
import { LogConsole } from '../LogConsole.jsx';
import { STACK, Status, ToggleRow } from './_settingsPrimitives.jsx';

const chainRegistry = registryLib.defaultRegistry();

export function DeveloperModeSection() {
    const { settings, loading, error, update } = useSettings();
    if (loading) return <Status text="Loading…" />;
    if (error) return <Status text={`Settings unavailable: ${error.message}`} tone="error" />;
    if (!settings) return <Status text="Settings unavailable." tone="error" />;

    const onToggle = async (field, next) => {
        try {
            await update({ [field]: next });
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error(`${field} update failed:`, err);
        }
    };

    return (
        <div style={STACK}>
            <ToggleRow
                label="Developer Mode"
                hint="Reveals regtest networks in chain pickers, custom-endpoint editors, and the raw PSBT inspector."
                checked={Boolean(settings.developerMode)}
                onChange={(v) => onToggle('developerMode', v)}
            />
            <ToggleRow
                label="Learn Mode"
                hint="Adds explanatory copy on confirmation screens for users new to bitcoin / XChain mechanics."
                checked={Boolean(settings.learnMode)}
                onChange={(v) => onToggle('learnMode', v)}
            />
            <RegtestNetworksRow developerMode={Boolean(settings.developerMode)} fees={settings.fees} />
            <ToggleRow
                label="Raw PSBT inspector"
                hint="Coming soon — reveals the raw PSBT hex + parsed fields on sign screens. §48.4."
                checked={false}
                disabled
                onChange={() => {}}
            />
            <ToggleRow
                label="Auto-approve localhost dApps"
                hint="Skip the bridge.connect prompt for http://localhost / 127.0.0.1 / [::1] origins. Requires Developer Mode. Sign requests still prompt — the password is needed to sign and the wallet never caches it."
                checked={Boolean(settings.autoApproveLocalhost)}
                disabled={!settings.developerMode}
                onChange={(v) => onToggle('autoApproveLocalhost', v)}
            />
            <LogConsoleRow developerMode={Boolean(settings.developerMode)} />
        </div>
    );
}

function LogConsoleRow({ developerMode }) {
    const [open, setOpen] = useState(false);
    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--xc-space-2)',
            padding: 'var(--xc-space-3)',
            background: 'var(--xc-surface-raised)',
            border: '1px solid var(--xc-border)',
            borderRadius: 'var(--xc-radius-md)',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--xc-space-2)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <span style={{ fontWeight: 500, color: 'var(--xc-text)' }}>Logs and diagnostics console</span>
                    <span style={{ color: 'var(--xc-text-muted)', fontSize: 'var(--xc-text-sm)' }}>
                        Process-wide ring buffer of console.* output. Useful when DevTools isn't available (popup, packaged desktop). Captures from now on — already-emitted entries are not replayed.
                        {!developerMode ? ' Turn Developer Mode on to view.' : ''}
                    </span>
                </div>
                <button
                    type="button"
                    onClick={() => setOpen((v) => !v)}
                    disabled={!developerMode}
                    style={{
                        background: 'transparent',
                        border: '1px solid var(--xc-border)',
                        color: 'var(--xc-text)',
                        borderRadius: 'var(--xc-radius-sm)',
                        padding: 'var(--xc-space-1) var(--xc-space-3)',
                        fontSize: 'var(--xc-text-xs)',
                        cursor: developerMode ? 'pointer' : 'not-allowed',
                        opacity: developerMode ? 1 : 0.5,
                    }}
                >
                    {open ? 'Hide' : 'Show'}
                </button>
            </div>
            {open && developerMode ? <LogConsole /> : null}
        </div>
    );
}

const REGTEST_BLOCK = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--xc-space-2)',
    padding: 'var(--xc-space-3)',
    background: 'var(--xc-surface-raised)',
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-md)',
};

function RegtestNetworksRow({ developerMode, fees }) {
    const regtests = chainRegistry.supportedChains()
        .filter((d) => d.networkKind === 'regtest')
        .sort((a, b) => a.coin.localeCompare(b.coin));
    if (regtests.length === 0) return null;
    return (
        <div style={REGTEST_BLOCK}>
            <div style={{ fontWeight: 600, color: 'var(--xc-text)' }}>Regtest networks</div>
            <div style={{ color: 'var(--xc-text-muted)', fontSize: 'var(--xc-text-sm)' }}>
                Activate a bundled regtest descriptor on this wallet. Seeds the per-chain fee + ADS records and derives the first address on the new chain across every existing account.
                {!developerMode ? ' Turn Developer Mode on to enable activation.' : ''}
            </div>
            {regtests.map((d) => (
                <RegtestRow
                    key={d.id}
                    descriptor={d}
                    isActive={Boolean(fees && fees[d.id])}
                    disabled={!developerMode}
                />
            ))}
        </div>
    );
}

function RegtestRow({ descriptor, isActive, disabled }) {
    const { messaging } = useMessaging();
    const [open, setOpen] = useState(false);
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [statusText, setStatusText] = useState(/** @type {string | null} */ (null));
    const [errorText, setErrorText] = useState(/** @type {string | null} */ (null));
    const [walletId, setWalletId] = useState(/** @type {string | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        if (typeof messaging?.listWallets !== 'function') return undefined;
        messaging.listWallets().then((wallets) => {
            if (cancelled) return;
            const first = Array.isArray(wallets) ? wallets[0] : null;
            setWalletId(first?.id ?? null);
        }).catch(() => { /* silent — activate button stays disabled */ });
        return () => { cancelled = true; };
    }, [messaging]);

    const onActivate = async (event) => {
        event.preventDefault();
        if (busy || !walletId) return;
        if (typeof messaging?.activateChainRequest !== 'function') {
            setErrorText('Activation is not wired in this shell yet.');
            return;
        }
        if (password.length === 0) {
            setErrorText('Wallet password is required.');
            return;
        }
        setBusy(true);
        setErrorText(null);
        setStatusText(null);
        try {
            const r = await messaging.activateChainRequest({
                walletId,
                chainId: descriptor.id,
                password,
            });
            const created = Array.isArray(r?.addresses) ? r.addresses.length : 0;
            const skipped = Number.isFinite(r?.skippedAccounts) ? r.skippedAccounts : 0;
            setStatusText(
                created > 0
                    ? `Activated. Derived ${created} address${created === 1 ? '' : 'es'}${skipped > 0 ? ` (${skipped} account${skipped === 1 ? '' : 's'} already had one)` : ''}.`
                    : 'Already activated — no new addresses needed.',
            );
            setPassword('');
            setOpen(false);
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setErrorText(isBadPassword ? 'Incorrect password.' : (err?.message || 'Activation failed.'));
        } finally {
            setBusy(false);
        }
    };

    const onCancel = () => {
        setOpen(false);
        setPassword('');
        setErrorText(null);
    };

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--xc-space-1)',
            padding: 'var(--xc-space-2)',
            border: '1px solid var(--xc-border)',
            borderRadius: 'var(--xc-radius-sm)',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--xc-space-2)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <span style={{ fontWeight: 500, color: 'var(--xc-text)' }}>{descriptor.displayName}</span>
                    <span style={{ color: 'var(--xc-text-muted)', fontSize: 'var(--xc-text-xs)' }}>
                        {descriptor.id} · explorer {descriptor.explorer?.defaultUrl}:{descriptor.explorer?.defaultPort}
                    </span>
                </div>
                {isActive ? (
                    <span style={{ color: 'var(--xc-success, var(--xc-text))', fontSize: 'var(--xc-text-xs)', fontWeight: 600 }}>Active</span>
                ) : (
                    <button
                        type="button"
                        onClick={() => setOpen(true)}
                        disabled={disabled || open}
                        style={{
                            background: 'transparent',
                            border: '1px solid var(--xc-border)',
                            color: 'var(--xc-text)',
                            borderRadius: 'var(--xc-radius-sm)',
                            padding: 'var(--xc-space-1) var(--xc-space-3)',
                            fontSize: 'var(--xc-text-xs)',
                            cursor: disabled ? 'not-allowed' : 'pointer',
                            opacity: disabled ? 0.5 : 1,
                        }}
                    >
                        Activate…
                    </button>
                )}
            </div>
            {open ? (
                <form onSubmit={onActivate} style={{ display: 'flex', gap: 'var(--xc-space-1)', alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Wallet password"
                        autoComplete="current-password"
                        disabled={busy}
                        aria-label={`${descriptor.displayName} activation password`}
                        style={{
                            flex: 1,
                            background: 'var(--xc-bg)',
                            color: 'var(--xc-text)',
                            border: '1px solid var(--xc-border)',
                            borderRadius: 'var(--xc-radius-sm)',
                            padding: 'var(--xc-space-1) var(--xc-space-2)',
                            fontSize: 'var(--xc-text-sm)',
                        }}
                    />
                    <button type="submit" disabled={busy || password.length === 0} style={{
                        background: 'var(--xc-accent-primary)',
                        borderColor: 'var(--xc-accent-primary)',
                        color: 'var(--xc-bg)',
                        border: '1px solid',
                        borderRadius: 'var(--xc-radius-sm)',
                        padding: 'var(--xc-space-1) var(--xc-space-3)',
                        fontSize: 'var(--xc-text-xs)',
                        cursor: busy ? 'wait' : 'pointer',
                    }}>
                        {busy ? 'Activating…' : 'Activate'}
                    </button>
                    <button type="button" onClick={onCancel} disabled={busy} style={{
                        background: 'transparent',
                        border: '1px solid var(--xc-border)',
                        color: 'var(--xc-text)',
                        borderRadius: 'var(--xc-radius-sm)',
                        padding: 'var(--xc-space-1) var(--xc-space-2)',
                        fontSize: 'var(--xc-text-xs)',
                        cursor: 'pointer',
                    }}>Cancel</button>
                </form>
            ) : null}
            {statusText ? <Status text={statusText} /> : null}
            {errorText ? <Status text={errorText} tone="error" /> : null}
        </div>
    );
}
