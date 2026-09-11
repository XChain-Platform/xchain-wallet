// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Delivery-network dropdown data shared by the messaging surfaces (Compose
// and the thread reply confirmation): user-facing coin labels, display
// order, and the short "why pick this chain" note shown in brackets next to
// each network. A MESSAGE can broadcast on any chain regardless of the
// recipient's chain, so the user picks the network that funds + pays the fee.

const DELIVERY_COIN_LABEL = { bitcoin: 'Bitcoin', litecoin: 'Litecoin', dogecoin: 'Dogecoin' };
const DELIVERY_COIN_ORDER = { bitcoin: 0, litecoin: 1, dogecoin: 2 };
const DELIVERY_COIN_CHARACTERISTIC = {
    bitcoin: 'slowest + strongest',
    litecoin: 'faster + cheaper',
    dogecoin: 'fastest + cheapest',
};

/**
 * The "Delivery network" choices for an account: one per chain it holds
 * addresses on, labeled by coin with its trade-off note, ordered BTC, LTC,
 * DOGE. Shaped for `<IconSelect>` (value / label / icon).
 *
 * @param {object} opts
 * @param {Record<string, unknown> | null} opts.addressesByChain  any chainId-keyed record; only the keys are read
 * @param {{ get: (id: string) => any }} opts.chainRegistry
 * @param {(chainId: string) => string | null} opts.chainIconSmallUrl
 * @param {(url: string) => any} opts.renderIcon  wraps a URL in the shell's img element
 * @returns {Array<{ value: string, label: string, icon: any }>}
 */
export function buildDeliveryNetworkOptions({ addressesByChain, chainRegistry, chainIconSmallUrl, renderIcon }) {
    const out = [];
    for (const chainId of Object.keys(addressesByChain || {})) {
        const coin = chainRegistry.get(chainId)?.coin;
        if (!coin) continue;
        const label = DELIVERY_COIN_LABEL[coin] || coin;
        const note = DELIVERY_COIN_CHARACTERISTIC[coin];
        const url = chainIconSmallUrl(chainId);
        out.push({
            value: chainId,
            coin,
            label: note ? `${label} (${note})` : label,
            icon: url ? renderIcon(url) : null,
        });
    }
    out.sort((a, b) => (DELIVERY_COIN_ORDER[a.coin] ?? 9) - (DELIVERY_COIN_ORDER[b.coin] ?? 9));
    return out;
}
