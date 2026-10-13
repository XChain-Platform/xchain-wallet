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
//   - "Upgrade recovery phrase" row, only when the active wallet's format
//     is `counterwallet-legacy`; it opens the wallet list, whose details
//     screen carries the migration button.
//   - "Remove wallet": destructive delete with two-step confirmation
//     (typed-name confirmation modal). Wires `wallet.remove` host
//     handler / `messaging.removeWallet` wrapper added in this step.

import { useState } from 'react';
import { useMessaging } from '../../useMessaging.js';
import { clearLastView } from '../../utils/lastViewMemory.js';
import { sweepMsgMemoryForWallet } from '../../utils/msgReadMemory.js';
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
    color: 'var(--xc-danger-fg)',
    borderColor: 'var(--xc-danger-fg)',
};

/**
 * @param {object} props
 * @param {{ id: string, name: string, format?: string } | null} [props.activeWallet]
 * @param {() => void} [props.onOpenWalletPicker]
 * @param {(walletId: string) => void | Promise<void>} [props.onWalletRemoved]
 * @param {(busy: boolean) => void} [props.onBusyChange]
 */
export function ThisWalletSection({
    activeWallet,
    onOpenWalletPicker,
    onWalletRemoved,
    onBusyChange,
}) {
    const { messaging } = useMessaging();
    const [confirmingRemove, setConfirmingRemove] = useState(false);
    const [removeError, setRemoveError] = useState(/** @type {string | null} */ (null));
    const [removing, setRemoving] = useState(false);
    const [removed, setRemoved] = useState(false);

    if (removed) {
        return (
            <Status
                text={removeError
                    ? `Wallet removed, but the app could not finish switching wallets: ${removeError}`
                    : 'Wallet removed.'}
                tone={removeError ? 'error' : undefined}
            />
        );
    }

    if (!activeWallet) {
        return <Status text="No active wallet." />;
    }

    const onConfirmRemove = async () => {
        // Refuse removal when this shell cannot delete the wallet record.
        if (typeof messaging?.removeWallet !== 'function') {
            setRemoveError('Wallet removal is not wired in this shell yet.');
            return;
        }
        setRemoving(true);
        onBusyChange?.(true);
        setRemoveError(null);
        let removalSucceeded = false;
        try {
            await messaging.removeWallet({ walletId: activeWallet.id });
            removalSucceeded = true;
            // Cluster U FOLLOWUP 5: drop the resume-last-view memory
            // for this wallet so a future wallet that happens to reuse
            // the same id (vanishingly unlikely with cuids, but the
            // hygiene cost is zero) doesn't inherit a stale route.
            clearLastView(activeWallet.id);
            // sweep this wallet's messaging read marks/unread
            // counts too, or they orphan in localStorage forever.
            sweepMsgMemoryForWallet(activeWallet.id);
            setConfirmingRemove(false);
            setRemoved(true);
            if (typeof onWalletRemoved === 'function') {
                await onWalletRemoved(activeWallet.id);
            }
        } catch (err) {
            setRemoveError(err instanceof Error ? err.message : String(err));
            if (removalSucceeded) setRemoved(true);
        } finally {
            setRemoving(false);
            onBusyChange?.(false);
        }
    };

    return (
        <div style={STACK}>
            <Row
                label="Wallet"
                hint={activeWallet.name}
                actionLabel={onOpenWalletPicker ? 'Switch / rename…' : null}
                onClick={onOpenWalletPicker}
                disabled={removing}
            />
            {/* Offer the upgrade only to the older 12-word format; a standard wallet has nothing to upgrade. */}
            {activeWallet.format === 'counterwallet-legacy' ? (
                <Row
                    label="Upgrade recovery phrase"
                    hint="This wallet uses an older 12-word recovery phrase format. Open your wallets, choose this wallet's details, and pick Upgrade recovery phrase."
                    actionLabel={onOpenWalletPicker ? 'Open wallets…' : null}
                    onClick={onOpenWalletPicker}
                    disabled={removing}
                />
            ) : null}
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

function Row({ label, hint, actionLabel, onClick, disabled = false }) {
    return (
        <div style={ROW}>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                <span style={{ color: 'var(--xc-text)', fontWeight: 500 }}>{label}</span>
                <span style={ROW_HINT}>{hint}</span>
            </div>
            {actionLabel && onClick ? (
                <button type="button" onClick={onClick} style={ACTION_BTN} disabled={disabled}>{actionLabel}</button>
            ) : null}
        </div>
    );
}

function RemoveConfirm({ walletName, busy, error, onCancel, onConfirm }) {
    const [typed, setTyped] = useState('');
    // Require the exact wallet name so accidental destructive clicks stay disabled.
    const matches = typed === walletName;
    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--xc-space-2)',
            padding: 'var(--xc-space-3)',
            background: 'var(--xc-surface-raised)',
            border: '1px solid var(--xc-danger-fg)',
            borderRadius: 'var(--xc-radius-md)',
        }}>
            <div style={{ color: 'var(--xc-danger-fg)', fontWeight: 600 }}>
                Permanent deletion
            </div>
            <div style={ROW_HINT}>
                Type the wallet name <strong style={{ color: 'var(--xc-text)' }}>{walletName}</strong> to confirm.
                The encrypted seed is destroyed and cannot be undone.
            </div>
            <input
                type="text"
                enterKeyHint="done"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' && matches && !busy) onConfirm();
                }}
                placeholder={walletName}
                aria-label="Confirm wallet name"
                autoFocus
                disabled={busy}
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
                        background: matches && !busy ? 'var(--xc-danger-fg)' : 'transparent',
                        color: matches && !busy ? 'var(--xc-on-accent)' : 'var(--xc-danger-fg)',
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
