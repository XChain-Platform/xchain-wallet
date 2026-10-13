// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// NetworkSection: active-network picker.
//
// Switches the wallet between Mainnet / Testnet / Regtest. Chains on
// the inactive networks stay configured but go dormant: no balance
// polling, no history fetches, no reachability checks, no SDK round-
// trips. Switching back is instant; cached data isn't wiped, so it
// reappears as soon as the filter flips.
//
// After a flip we reload the page. Many components fetch their chain-
// scoped state once in a useEffect keyed only on (walletId, accountId)
// and won't re-derive when settings.activeNetwork changes. A reload is
// the cheapest robust path to a fully consistent post-switch UI.

import { useState } from 'react';
import { useSettings } from '../../hooks/useSettings.js';
import { useConfirmModal } from '../../hooks/useConfirmModal.js';
import { useMessaging } from '../../useMessaging.js';
import { userFacingMessage } from '../../utils/userFacingMessage.js';
import { NETWORKS, NETWORK_DEFAULT } from '../../../schemas/settings.js';
import { ROW, SELECT, SettingsLoadError, Status } from './_settingsPrimitives.jsx';
import { ConfirmModal } from '../ConfirmModal.jsx';

const NETWORK_OPTIONS = /** @type {const} */ ([
    { value: 'mainnet', label: 'Mainnet' },
    { value: 'testnet', label: 'Testnet' },
    { value: 'regtest', label: 'Regtest' },
]);

export function NetworkSection({ activeWallet } = {}) {
    const { settings, loading, error, update } = useSettings();
    const { messaging } = useMessaging();
    const confirmDialog = useConfirmModal();
    const [switching, setSwitching] = useState(false);
    const [switchError, setSwitchError] = useState(/** @type {string|null} */ (null));
    const walletId = activeWallet?.id;

    if (loading) return <Status text="Loading…" />;
    if (error) return <SettingsLoadError error={error} />;
    if (!settings) return <Status text="Settings unavailable." tone="error" />;

    const current = NETWORKS.includes(settings.activeNetwork)
        ? settings.activeNetwork
        : NETWORK_DEFAULT;

    // Regtest is a developer-only local network. Hide it from ordinary
    // users (the app already promises this in the Developer Mode copy),
    // but keep it visible when it is the active network so a user who is
    // already on regtest with dev mode off still has a way to switch back.
    const showRegtest = Boolean(settings.developerMode) || current === 'regtest';
    const options = showRegtest
        ? NETWORK_OPTIONS
        : NETWORK_OPTIONS.filter((opt) => opt.value !== 'regtest');

    const onChange = async (next) => {
        if (!NETWORKS.includes(next)) return;
        if (next === current) return;
        const nextLabel = NETWORK_OPTIONS.find((option) => option.value === next)?.label || next;
        const currentLabel = NETWORK_OPTIONS.find((option) => option.value === current)?.label || current;
        const confirmed = await confirmDialog.confirm({
            title: `Switch to ${nextLabel}?`,
            message: `The wallet will reload and show ${nextLabel} chains. Your ${currentLabel} balances and chain settings stay unchanged.`,
            confirmLabel: 'Switch network',
        });
        if (!confirmed) return;
        setSwitchError(null);
        setSwitching(true);
        try {
            // Prefer the host route that ALSO derives the first
            // address on each chain of the network being switched to.
            // Flipping the setting alone only changes a filter, which is how
            // this control used to strand a wallet with no addresses and no UI
            // path to create one. Falls back to the plain settings write for a
            // shell that predates the route, so the switch itself never breaks.
            if (typeof messaging?.setActiveNetwork === 'function' && walletId) {
                await messaging.setActiveNetwork({ walletId, network: next });
            } else {
                await update({ activeNetwork: next });
            }
            if (typeof window !== 'undefined') window.location.reload();
        } catch (err) {
            setSwitchError(userFacingMessage(err, 'Could not switch networks. Try again.'));
        } finally {
            setSwitching(false);
        }
    };

    return (
        <>
            <div style={ROW}>
                <span style={{ color: 'var(--xc-text-muted)' }}>Network</span>
                <select
                    value={current}
                    onChange={(e) => onChange(e.target.value)}
                    aria-label="Active network"
                    style={SELECT}
                    disabled={switching || Boolean(confirmDialog.request)}
                >
                    {options.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                </select>
            </div>
            {switchError ? (
                <div role="alert" style={{ color: 'var(--xc-danger, #c33)', fontSize: 'var(--xc-text-xs)' }}>
                    {switchError}
                </div>
            ) : null}
            {confirmDialog.request ? (
                <ConfirmModal
                    {...confirmDialog.request}
                    onConfirm={confirmDialog.onConfirm}
                    onCancel={confirmDialog.onCancel}
                />
            ) : null}
        </>
    );
}
