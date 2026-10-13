// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

const NETWORK_LABELS = {
    testnet: 'Testnet',
    regtest: 'Regtest',
};

/**
 * Keeps non-mainnet context visible above every unlocked route. Mainnet and
 * an unloaded setting render nothing so the marker never guesses a network.
 *
 * @param {{ activeNetwork?: 'mainnet' | 'testnet' | 'regtest' }} props
 */
export function NetworkBanner({ activeNetwork }) {
    const label = NETWORK_LABELS[activeNetwork];
    if (!label) return null;

    return (
        <div
            role="status"
            aria-label={`Active network: ${label}. Amounts shown are on ${label}.`}
            style={BANNER_STYLE}
        >
            <strong>{label}</strong>
            <span aria-hidden="true"> · </span>
            <span>Not mainnet</span>
        </div>
    );
}

const BANNER_STYLE = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '24px',
    boxSizing: 'border-box',
    padding: '3px var(--xc-space-3, 12px)',
    borderBottom: '1px solid var(--xc-warning, #b7791f)',
    color: 'var(--xc-warning, #8a5a12)',
    // A token rather than color-mix(): Android WebView 102 drops color-mix.
    background: 'var(--xc-warning-bg, rgba(217, 119, 6, 0.10))',
    fontSize: 'var(--xc-text-xs, 0.75rem)',
    lineHeight: 1.3,
};
