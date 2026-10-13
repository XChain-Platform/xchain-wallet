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
import { useMessaging } from '../../useMessaging.js';
import {
    activeNetworkOptions,
    confirmActiveNetworkSwitch,
    normalizeActiveNetwork,
    persistActiveNetwork,
} from '../../utils/activeNetworkSwitch.js';
import { ROW, SELECT, SettingsLoadError, Status } from './_settingsPrimitives.jsx';

export function NetworkSection({ activeWallet, reload = reloadPage } = {}) {
    const { settings, loading, error, update } = useSettings();
    const { messaging } = useMessaging();
    const [switching, setSwitching] = useState(false);
    const walletId = activeWallet?.id;

    if (loading) return <Status text="Loading…" />;
    if (error) return <SettingsLoadError error={error} />;
    if (!settings) return <Status text="Settings unavailable." tone="error" />;

    const current = normalizeActiveNetwork(settings.activeNetwork);

    // Regtest is a developer-only local network. Hide it from ordinary
    // users (the app already promises this in the Developer Mode copy),
    // but keep it visible when it is the active network so a user who is
    // already on regtest with dev mode off still has a way to switch back.
    const options = activeNetworkOptions({
        developerMode: Boolean(settings.developerMode),
        current,
    });

    const onChange = async (next) => {
        if (next === current) return;
        if (!confirmActiveNetworkSwitch(current, next)) return;
        setSwitching(true);
        try {
            // Prepare destination addresses before reloading so every
            // balance, history, and chain picker mounts against usable data.
            await persistActiveNetwork({ messaging, update, walletId, network: next });
            reload();
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error('activeNetwork update failed:', err);
            setSwitching(false);
        }
    };

    return (
        <div style={ROW}>
            <span style={{ color: 'var(--xc-text-muted)' }}>Network</span>
            <select
                value={current}
                onChange={(e) => onChange(e.target.value)}
                aria-label="Active network"
                disabled={switching}
                style={SELECT}
            >
                {options.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
            </select>
        </div>
    );
}

function reloadPage() {
    if (typeof window !== 'undefined') window.location.reload();
}
