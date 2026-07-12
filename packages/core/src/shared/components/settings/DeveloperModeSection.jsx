// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// DeveloperModeSection (§35.1 + §48): Developer Mode panel.
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
//     §48.6 / G151: when both this and Developer Mode are on,
//     `bridge.connect` from localhost / 127.0.0.1 / [::1] origins
//     skips the approval prompt. Sign requests still prompt (the
//     password is required to sign and the wallet never caches it).
//   - Regtest networks subsection (§48.3 / G149). Lists the bundled
//     regtest descriptors and lets the user activate one at runtime
//     via `messaging.activateChainRequest`. Idempotent re-activation
//     is a no-op.
//   - Custom chains subsection (§9.7 / Cluster Q FOLLOWUP 2). Paste a
//     JSON ChainDescriptor blob to add it to the running ChainRegistry;
//     persisted across SW restarts. Remove cleans both the persisted
//     record and the in-memory registry entry.
//   - Logs and diagnostics console (§48.5 / G150).
//
// Deferred:
//   - Raw PSBT inspector reveal on sign screens (§48.4)

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
            <ToggleRow
                label="Show variant popover"
                hint="Web app only. Shows the floating layout-variant switcher (small / full / sidebar / extension preview) for previewing shells. Requires Developer Mode."
                checked={Boolean(settings.showVariantBadge)}
                disabled={!settings.developerMode}
                onChange={(v) => onToggle('showVariantBadge', v)}
            />
            <RegtestNetworksRow developerMode={Boolean(settings.developerMode)} fees={settings.fees} />
            <CustomChainsRow developerMode={Boolean(settings.developerMode)} />
            <ToggleRow
                label="Raw PSBT inspector"
                /* Spec §48.4 */
                hint="Coming soon: reveals the raw PSBT hex + parsed fields on sign screens."
                checked={false}
                disabled
                onChange={() => {}}
            />
            <ToggleRow
                label="Auto-approve localhost dApps"
                hint="Skip the bridge.connect prompt for http://localhost / 127.0.0.1 / [::1] origins. Requires Developer Mode. Sign requests still prompt (the password is needed to sign and the wallet never caches it)."
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
                        Process-wide ring buffer of console.* output. Useful when DevTools isn't available (popup, packaged desktop). Captures from now on; already-emitted entries are not replayed.
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
        }).catch(() => { /* silent; activate button stays disabled */ });
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
                    : 'Already activated. No new addresses needed.',
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

// §9.7 / Cluster Q FOLLOWUP 2: Custom chains subsection.
//
// Persisted user-added ChainDescriptor entries surfaced as a list with
// per-row Remove buttons + an "Add custom chain" form that accepts a
// JSON descriptor blob. The form is intentionally minimal: pasting a
// full ChainDescriptor JSON is the canonical path because the spec
// shape has 16+ fields (derivation paths, fee strategies, endpoints,
// adsDonationAddress, etc.). A guided form would be large and quickly
// drift from the validator. Validation runs in the host route
// (`chainRegistry.addCustomChain` → `validateChainDescriptor`); error
// messages here are forwarded verbatim so the user sees exactly which
// field failed.
function CustomChainsRow({ developerMode }) {
    const { messaging } = useMessaging();
    const [chains, setChains] = useState(/** @type {object[]} */ ([]));
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [open, setOpen] = useState(false);
    const [pasted, setPasted] = useState('');
    const [busy, setBusy] = useState(false);
    const [errorText, setErrorText] = useState(/** @type {string | null} */ (null));
    const [statusText, setStatusText] = useState(/** @type {string | null} */ (null));

    const refresh = async () => {
        if (typeof messaging?.listCustomChains !== 'function') {
            setChains([]);
            setLoading(false);
            return;
        }
        try {
            const r = await messaging.listCustomChains();
            setChains(Array.isArray(r?.descriptors) ? r.descriptors : []);
            setLoadError(null);
        } catch (err) {
            setLoadError(err?.message || 'Failed to load custom chains.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        let cancelled = false;
        if (typeof messaging?.listCustomChains !== 'function') {
            setChains([]);
            setLoading(false);
            return undefined;
        }
        messaging.listCustomChains()
            .then((r) => {
                if (cancelled) return;
                setChains(Array.isArray(r?.descriptors) ? r.descriptors : []);
                setLoadError(null);
            })
            .catch((err) => {
                if (cancelled) return;
                setLoadError(err?.message || 'Failed to load custom chains.');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [messaging]);

    const onAdd = async (event) => {
        event.preventDefault();
        if (busy) return;
        if (typeof messaging?.addCustomChain !== 'function') {
            setErrorText('addCustomChain is not wired in this shell yet.');
            return;
        }
        let descriptor;
        try {
            descriptor = JSON.parse(pasted);
        } catch (err) {
            setErrorText(`Invalid JSON: ${err?.message || 'parse failed'}`);
            return;
        }
        setBusy(true);
        setErrorText(null);
        setStatusText(null);
        try {
            const r = await messaging.addCustomChain({ descriptor });
            const id = r?.descriptor?.id || descriptor?.id || '(unknown)';
            setStatusText(`Added "${id}".`);
            setPasted('');
            setOpen(false);
            await refresh();
        } catch (err) {
            setErrorText(err?.message || 'Failed to add custom chain.');
        } finally {
            setBusy(false);
        }
    };

    const onRemove = async (chainId) => {
        if (busy) return;
        if (typeof messaging?.removeCustomChain !== 'function') {
            setErrorText('removeCustomChain is not wired in this shell yet.');
            return;
        }
        setBusy(true);
        setErrorText(null);
        setStatusText(null);
        try {
            await messaging.removeCustomChain({ chainId });
            setStatusText(`Removed "${chainId}".`);
            await refresh();
        } catch (err) {
            setErrorText(err?.message || 'Failed to remove custom chain.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div style={REGTEST_BLOCK}>
            <div style={{ fontWeight: 600, color: 'var(--xc-text)' }}>Custom chains</div>
            <div style={{ color: 'var(--xc-text-muted)', fontSize: 'var(--xc-text-sm)' }}>
                Plug in a non-bundled ChainDescriptor (e.g. a fork's regtest, an alt explorer). Persists across restarts. Removed chains are also un-registered immediately.
                {!developerMode ? ' Turn Developer Mode on to manage custom chains.' : ''}
            </div>
            {loadError ? <Status text={loadError} tone="error" /> : null}
            {!loading && chains.length === 0 && !loadError ? (
                <div style={{ color: 'var(--xc-text-muted)', fontSize: 'var(--xc-text-xs)' }}>
                    No custom chains yet.
                </div>
            ) : null}
            {chains.map((d) => (
                <div key={d?.id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 'var(--xc-space-2)',
                    padding: 'var(--xc-space-2)',
                    border: '1px solid var(--xc-border)',
                    borderRadius: 'var(--xc-radius-sm)',
                }}>
                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                        <span style={{ fontWeight: 500, color: 'var(--xc-text)' }}>
                            {d?.displayName || d?.id}
                        </span>
                        <span style={{ color: 'var(--xc-text-muted)', fontSize: 'var(--xc-text-xs)' }}>
                            {d?.id}{d?.networkKind ? ` · ${d.networkKind}` : ''}
                        </span>
                    </div>
                    <button
                        type="button"
                        onClick={() => onRemove(d?.id)}
                        disabled={!developerMode || busy}
                        aria-label={`Remove custom chain ${d?.id}`}
                        style={{
                            background: 'transparent',
                            border: '1px solid var(--xc-border)',
                            color: 'var(--xc-text)',
                            borderRadius: 'var(--xc-radius-sm)',
                            padding: 'var(--xc-space-1) var(--xc-space-3)',
                            fontSize: 'var(--xc-text-xs)',
                            cursor: !developerMode || busy ? 'not-allowed' : 'pointer',
                            opacity: !developerMode || busy ? 0.5 : 1,
                        }}
                    >Remove</button>
                </div>
            ))}
            {open ? (
                <form onSubmit={onAdd} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--xc-space-1)' }}>
                    <label style={{ color: 'var(--xc-text-muted)', fontSize: 'var(--xc-text-xs)' }}>
                        Paste a full ChainDescriptor JSON (id, coin, displayName, networkKind, derivationPaths, addressTypes, defaultAddressType, feeStrategy, supportedActions, uriScheme, wifVersionByte, explorer, encoder, hub, adsDonationAddress).
                    </label>
                    <textarea
                        value={pasted}
                        onChange={(e) => setPasted(e.target.value)}
                        placeholder={'{\n  "id": "my-fork-regtest",\n  "coin": "myfork",\n  "networkKind": "regtest",\n  ...\n}'}
                        rows={8}
                        spellCheck={false}
                        disabled={busy}
                        aria-label="Custom chain descriptor JSON"
                        style={{
                            background: 'var(--xc-bg)',
                            color: 'var(--xc-text)',
                            border: '1px solid var(--xc-border)',
                            borderRadius: 'var(--xc-radius-sm)',
                            padding: 'var(--xc-space-2)',
                            fontFamily: 'monospace',
                            fontSize: 'var(--xc-text-xs)',
                            resize: 'vertical',
                        }}
                    />
                    <div style={{ display: 'flex', gap: 'var(--xc-space-1)' }}>
                        <button type="submit" disabled={busy || pasted.length === 0} style={{
                            background: 'var(--xc-accent-primary)',
                            borderColor: 'var(--xc-accent-primary)',
                            color: 'var(--xc-bg)',
                            border: '1px solid',
                            borderRadius: 'var(--xc-radius-sm)',
                            padding: 'var(--xc-space-1) var(--xc-space-3)',
                            fontSize: 'var(--xc-text-xs)',
                            cursor: busy ? 'wait' : 'pointer',
                        }}>{busy ? 'Adding…' : 'Add chain'}</button>
                        <button type="button" onClick={() => { setOpen(false); setPasted(''); setErrorText(null); }} disabled={busy} style={{
                            background: 'transparent',
                            border: '1px solid var(--xc-border)',
                            color: 'var(--xc-text)',
                            borderRadius: 'var(--xc-radius-sm)',
                            padding: 'var(--xc-space-1) var(--xc-space-2)',
                            fontSize: 'var(--xc-text-xs)',
                            cursor: 'pointer',
                        }}>Cancel</button>
                    </div>
                </form>
            ) : (
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    disabled={!developerMode || busy}
                    style={{
                        alignSelf: 'flex-start',
                        background: 'transparent',
                        border: '1px solid var(--xc-border)',
                        color: 'var(--xc-text)',
                        borderRadius: 'var(--xc-radius-sm)',
                        padding: 'var(--xc-space-1) var(--xc-space-3)',
                        fontSize: 'var(--xc-text-xs)',
                        cursor: !developerMode || busy ? 'not-allowed' : 'pointer',
                        opacity: !developerMode || busy ? 0.5 : 1,
                    }}
                >Add custom chain…</button>
            )}
            {statusText ? <Status text={statusText} /> : null}
            {errorText ? <Status text={errorText} tone="error" /> : null}
        </div>
    );
}
