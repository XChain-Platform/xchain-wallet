// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { defaultRegistry } from '../../registry/index.js';
import { explorerCoinCode } from '../../registry/coinTicker.js';
import { endpointOverridesFromSettings, joinEndpoint } from '../../sdk/SDKRegistry.js';

const ROUTE_SEGMENTS = Object.freeze({
    transaction: 'tx',
    action: 'action',
    address: 'address',
    token: 'token',
    dispenser: 'dispenser',
});

/**
 * Returns the explorer origin configured for one chain. The Settings record
 * follows the same override rules as SDKRegistry so reads and browser links
 * always reach the same operator-selected explorer.
 */
export function explorerBaseUrl(chainId, settings, chainRegistry = defaultRegistry()) {
    const descriptor = chainRegistry?.get?.(chainId);
    if (!descriptor) return null;
    const override = endpointOverridesFromSettings(settings, chainRegistry)[chainId]?.explorerUrl;
    const base = override || joinEndpoint(descriptor.explorer);
    return typeof base === 'string' && base.trim()
        ? base.trim().replace(/\/+$/, '')
        : null;
}

/**
 * Builds a public XChain Explorer page URL for one chain-scoped value.
 * Identifiers are encoded as one path segment so token names and custom
 * address formats cannot change the route shape.
 */
export function explorerPageUrl({
    chainId,
    kind,
    value,
    settings = null,
    chainRegistry = defaultRegistry(),
}) {
    const segment = ROUTE_SEGMENTS[kind];
    if (!segment || value == null) return null;
    const identifier = String(value).trim();
    if (!identifier) return null;
    const descriptor = chainRegistry?.get?.(chainId);
    const coin = explorerCoinCode(descriptor);
    const base = explorerBaseUrl(chainId, settings, chainRegistry);
    if (!coin || !base) return null;
    return `${base}/${coin}/${segment}/${encodeURIComponent(identifier)}`;
}
