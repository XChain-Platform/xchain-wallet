// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// WalletModeSection: §20 wallet-mode selector. A mode change affects every
// signing surface, so the choice stays pending until the user confirms it.

import { useState } from 'react';
import { Button } from '@xchain-wallet/core/ui';
import { useSettings } from '../../hooks/useSettings.js';
import { WALLET_MODES, WALLET_MODE_DEFAULT } from '../../../schemas/settings.js';
import { ROW, ROW_HINT, STACK, SettingsLoadError, Status } from './_settingsPrimitives.jsx';
import { useBackHandler } from '../../../ui/backStack.js';

const MODE_OPTIONS = /** @type {const} */ ([
    {
        value: 'full',
        label: 'Normal',
        hint: 'Sign and broadcast transactions on this device. Password and hardware-signing prompts are available.',
        confirmation: 'Normal mode can use this device\'s private keys to sign and broadcast transactions.',
    },
    {
        value: 'watcher',
        label: 'Watcher (watch-only)',
        hint: 'View balances and build unsigned transactions. This device never asks for a signing password or signs them.',
        confirmation: 'Watcher mode stops this device from signing. Transaction actions produce unsigned PSBTs to move to a separate signer.',
    },
    {
        value: 'signer',
        label: 'Signer (air-gapped)',
        hint: 'Sign transactions pasted in from a watcher wallet. Send / receive screens are hidden; this wallet does not broadcast.',
        confirmation: 'Signer mode hides Send and Receive. This device signs imported PSBTs but does not broadcast them.',
    },
]);

export function WalletModeSection() {
    const { settings, loading, error, update } = useSettings();
    const [pending, setPending] = useState(/** @type {typeof WALLET_MODES[number] | null} */ (null));
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState(/** @type {string | null} */ (null));
    useBackHandler(pending ? () => setPending(null) : undefined, saving);

    if (loading) return <Status text="Loading…" />;
    if (error) return <SettingsLoadError error={error} />;
    if (!settings) return <Status text="Settings unavailable." tone="error" />;

    const current = WALLET_MODES.includes(settings.walletMode)
        ? settings.walletMode
        : WALLET_MODE_DEFAULT;

    const onChange = (next) => {
        if (!WALLET_MODES.includes(next)) return;
        setSaveError(null);
        setPending(next === current ? null : next);
    };

    const confirmChange = async () => {
        if (!pending || saving) return;
        setSaving(true);
        setSaveError(null);
        try {
            await update({ walletMode: pending });
            setPending(null);
        } catch (err) {
            setSaveError(err?.message || 'Could not save the wallet mode.');
            // eslint-disable-next-line no-console
            console.error('walletMode update failed:', err);
        } finally {
            setSaving(false);
        }
    };

    const selected = pending || current;
    const pendingOption = MODE_OPTIONS.find((opt) => opt.value === pending);

    return (
        <fieldset
            style={{
                ...STACK,
                border: 'none',
                padding: 0,
                margin: 0,
            }}
        >
            <legend
                style={{
                    color: 'var(--xc-text-muted)',
                    fontSize: 'var(--xc-text-xs)',
                    marginBottom: 'var(--xc-space-1)',
                }}
            >
                Choose how this wallet handles transactions. Watcher and Signer are paired modes for air-gapped signing.
            </legend>
            {MODE_OPTIONS.map((opt) => (
                <label
                    key={opt.value}
                    style={{
                        ...ROW,
                        alignItems: 'flex-start',
                        cursor: 'pointer',
                    }}
                >
                    <input
                        type="radio"
                        name="walletMode"
                        value={opt.value}
                        checked={selected === opt.value}
                        onChange={() => onChange(opt.value)}
                        disabled={saving}
                        aria-describedby={`walletMode-${opt.value}-hint`}
                        style={{
                            marginTop: 2,
                            marginInlineEnd: 'var(--xc-space-2)',
                            cursor: 'pointer',
                            flexShrink: 0,
                        }}
                    />
                    <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                        <span style={{ color: 'var(--xc-text)', fontWeight: 500 }}>{opt.label}</span>
                        <span id={`walletMode-${opt.value}-hint`} style={ROW_HINT}>
                            {opt.hint}
                        </span>
                    </span>
                </label>
            ))}
            {pendingOption ? (
                <div
                    role="alertdialog"
                    aria-labelledby="walletMode-confirm-title"
                    aria-describedby="walletMode-confirm-copy"
                    style={{
                        ...STACK,
                        padding: 'var(--xc-space-3)',
                        border: '1px solid var(--xc-border)',
                        borderRadius: 'var(--xc-radius-md)',
                        background: 'var(--xc-surface-raised)',
                    }}
                >
                    <strong id="walletMode-confirm-title" style={{ color: 'var(--xc-text)' }}>
                        Switch to {pendingOption.label} mode?
                    </strong>
                    <span id="walletMode-confirm-copy" style={ROW_HINT}>
                        {pendingOption.confirmation}
                    </span>
                    {saveError ? <span role="alert" style={{ color: 'var(--xc-danger)' }}>{saveError}</span> : null}
                    <span style={{ ...ROW, justifyContent: 'flex-end' }}>
                        <Button type="button" variant="secondary" onClick={() => setPending(null)} disabled={saving}>Cancel</Button>
                        <Button type="button" variant="primary" onClick={confirmChange} disabled={saving}>
                            {saving ? 'Saving…' : 'Confirm mode change'}
                        </Button>
                    </span>
                </div>
            ) : null}
        </fieldset>
    );
}
