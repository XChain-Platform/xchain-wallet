// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ThisWalletSection (§35.1 This Wallet panel).
//
// Inline replacement for the previous `kind: 'drill'` row. Surfaces:
//   - Active wallet name + a "Switch wallet" drilldown (preserves the
//     current behaviour; the WalletPicker is still reachable).
//   - "Rename" drilldown to the existing RenameWalletForm route.
//   - "Migrate to BIP39" drilldown when the active wallet's format is
//     `counterwallet-legacy`.
//   - "Remove wallet": destructive delete with two-step confirmation
//     (typed-name confirmation modal). Wires `wallet.remove` host
//     handler / `messaging.removeWallet` wrapper added in this step.

import { useState } from 'react';
import { useMessaging } from '../../useMessaging.js';
import { clearLastView } from '../../utils/lastViewMemory.js';
import { ROW, ROW_HINT, STACK, Status } from './_settingsPrimitives.jsx';

const ACTION_BTN = {
    background: 'transparent',
    border: '1px solid var(--xc-border)',
    color: 'var(--xc-text)',
    borderRadius: 'var(--xc-radius-sm)',
    padding: 'var(--xc-space-1) var(--xc-space-3)',
    fontSize: 'var(--xc-text-sm)',
    cursor: 'pointer',
};
const DESTRUCTIVE_BTN = {
    ...ACTION_BTN,
    color: 'var(--xc-error, #c33)',
    borderColor: 'var(--xc-error, #c33)',
};

/**
 * @param {object} props
 * @param {{ id: string, name: string, format?: string } | null} [props.activeWallet]
 * @param {() => void} [props.onOpenWalletPicker]
 * @param {() => void} [props.onWalletRemoved]
 */
export function ThisWalletSection({
    activeWallet,
    onOpenWalletPicker,
    onWalletRemoved,
}) {
    const { messaging } = useMessaging();
    const [confirmingRemove, setConfirmingRemove] = useState(false);
    const [removeError, setRemoveError] = useState(/** @type {string | null} */ (null));
    const [removing, setRemoving] = useState(false);

    if (!activeWallet) {
        return <Status text="No active wallet." />;
    }

    const onConfirmRemove = async () => {
        if (typeof messaging?.removeWallet !== 'function') {
            setRemoveError('Wallet removal is not wired in this shell yet.');
            return;
        }
        setRemoving(true);
        setRemoveError(null);
        try {
            await messaging.removeWallet({ walletId: activeWallet.id });
            // Cluster U FOLLOWUP 5: drop the resume-last-view memory
            // for this wallet so a future wallet that happens to reuse
            // the same id (vanishingly unlikely with cuids, but the
            // hygiene cost is zero) doesn't inherit a stale route.
            clearLastView(activeWallet.id);
            setConfirmingRemove(false);
            if (typeof onWalletRemoved === 'function') onWalletRemoved();
        } catch (err) {
            setRemoveError(err instanceof Error ? err.message : String(err));
        } finally {
            setRemoving(false);
        }
    };

    return (
        <div style={STACK}>
            <Row
                label="Wallet"
                value={activeWallet.name}
                actionLabel={onOpenWalletPicker ? 'Switch / rename…' : null}
                onClick={onOpenWalletPicker}
            />
            <Row
                label="Migrate to BIP39"
                value="Counterwallet-legacy migration is reachable via the wallet picker → details for legacy-format wallets."
                actionLabel={null}
                onClick={null}
            />
            {confirmingRemove ? (
                <RemoveConfirm
                    walletName={activeWallet.name}
                    busy={removing}
                    error={removeError}
                    onCancel={() => { setConfirmingRemove(false); setRemoveError(null); }}
                    onConfirm={onConfirmRemove}
                />
            ) : (
                <div style={ROW}>
                    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                        <span style={{ color: 'var(--xc-text)', fontWeight: 500 }}>Remove wallet</span>
                        <span style={ROW_HINT}>
                            Deletes the wallet and all linked records (accounts, addresses, signers,
                            pending txs). The encrypted seed is destroyed; back up first if you need
                            recovery.
                        </span>
                    </div>
                    <button
                        type="button"
                        onClick={() => { setConfirmingRemove(true); setRemoveError(null); }}
                        style={DESTRUCTIVE_BTN}
                    >
                        Remove…
                    </button>
                </div>
            )}
        </div>
    );
}

function Row({ label, value, actionLabel, onClick }) {
    return (
        <div style={ROW}>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                <span style={{ color: 'var(--xc-text)', fontWeight: 500 }}>{label}</span>
                <span style={ROW_HINT}>{value}</span>
            </div>
            {actionLabel && onClick ? (
                <button type="button" onClick={onClick} style={ACTION_BTN}>{actionLabel}</button>
            ) : null}
        </div>
    );
}

function RemoveConfirm({ walletName, busy, error, onCancel, onConfirm }) {
    const [typed, setTyped] = useState('');
    const matches = typed === walletName;
    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--xc-space-2)',
            padding: 'var(--xc-space-3)',
            background: 'var(--xc-surface-raised)',
            border: '1px solid var(--xc-error, #c33)',
            borderRadius: 'var(--xc-radius-md)',
        }}>
            <div style={{ color: 'var(--xc-error, #c33)', fontWeight: 600 }}>
                Permanent deletion
            </div>
            <div style={ROW_HINT}>
                Type the wallet name <strong style={{ color: 'var(--xc-text)' }}>{walletName}</strong> to confirm.
                The encrypted seed is destroyed and cannot be undone.
            </div>
            <input
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={walletName}
                aria-label="Confirm wallet name"
                autoFocus
                style={{
                    background: 'var(--xc-bg)',
                    color: 'var(--xc-text)',
                    border: '1px solid var(--xc-border)',
                    borderRadius: 'var(--xc-radius-sm)',
                    padding: 'var(--xc-space-2) var(--xc-space-3)',
                    fontSize: 'var(--xc-text-sm)',
                    fontFamily: 'inherit',
                }}
            />
            {error ? <Status text={error} tone="error" /> : null}
            <div style={{ display: 'flex', gap: 'var(--xc-space-2)', justifyContent: 'flex-end' }}>
                <button type="button" onClick={onCancel} style={ACTION_BTN} disabled={busy}>
                    Cancel
                </button>
                <button
                    type="button"
                    onClick={onConfirm}
                    disabled={!matches || busy}
                    style={{
                        ...DESTRUCTIVE_BTN,
                        background: matches && !busy ? 'var(--xc-error, #c33)' : 'transparent',
                        color: matches && !busy ? '#fff' : 'var(--xc-error, #c33)',
                        opacity: matches && !busy ? 1 : 0.6,
                        cursor: matches && !busy ? 'pointer' : 'not-allowed',
                    }}
                >
                    {busy ? 'Removing…' : 'Remove permanently'}
                </button>
            </div>
        </div>
    );
}
