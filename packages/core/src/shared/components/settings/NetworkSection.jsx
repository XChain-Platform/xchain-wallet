// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// NetworkSection — active-network picker.
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

import { useSettings } from '../../hooks/useSettings.js';
import { NETWORKS, NETWORK_DEFAULT } from '../../../schemas/settings.js';
import { ROW, SELECT, Status } from './_settingsPrimitives.jsx';

const NETWORK_OPTIONS = /** @type {const} */ ([
    { value: 'mainnet', label: 'Mainnet' },
    { value: 'testnet', label: 'Testnet' },
    { value: 'regtest', label: 'Regtest' },
]);

export function NetworkSection() {
    const { settings, loading, error, update } = useSettings();

    if (loading) return <Status text="Loading…" />;
    if (error) return <Status text={`Settings unavailable: ${error.message}`} tone="error" />;
    if (!settings) return <Status text="Settings unavailable." tone="error" />;

    const current = NETWORKS.includes(settings.activeNetwork)
        ? settings.activeNetwork
        : NETWORK_DEFAULT;

    const onChange = async (next) => {
        if (!NETWORKS.includes(next)) return;
        if (next === current) return;
        try {
            await update({ activeNetwork: next });
            if (typeof window !== 'undefined') window.location.reload();
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error('activeNetwork update failed:', err);
        }
    };

    return (
        <div style={ROW}>
            <span style={{ color: 'var(--xc-text-muted)' }}>Network</span>
            <select
                value={current}
                onChange={(e) => onChange(e.target.value)}
                aria-label="Active network"
                style={SELECT}
            >
                {NETWORK_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
            </select>
        </div>
    );
}
