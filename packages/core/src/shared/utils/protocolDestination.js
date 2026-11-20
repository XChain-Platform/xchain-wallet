// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

const destinations = (BURN, BRIDGE_A, BRIDGE_B) => Object.freeze({ BURN, ...BRIDGE_A, ...BRIDGE_B });

// Wallet-only safety data. These destinations deliberately stay outside the
// synchronized chain descriptors, whose shape is mirrored into the hub.
export const PROTOCOL_DESTINATIONS_BY_CHAIN_ID = Object.freeze({
    'bitcoin-mainnet': destinations(
        '1XChainBurnAddressXXXXXXXXXbRsd2N',
        { BRIDGE_LTC: '17BridgeLtcXChainXXXXXXXXXXa5uRRy' },
        { BRIDGE_DOGE: '17BridgeDogeXChainXXXXXXXXXVuqXcv' },
    ),
    'bitcoin-testnet': destinations(
        'mxchainburnaddressXXXXXXXXXXa8EAfp',
        { BRIDGE_LTC: 'mfbtcbridgeLtcXXXXXXXXXXXXXXVPqpoV' },
        { BRIDGE_DOGE: 'mfbtcbridgedogeXXXXXXXXXXXXXUXTr4m' },
    ),
    'bitcoin-regtest': destinations(
        'mxchainburnaddressXXXXXXXXXXa8EAfp',
        { BRIDGE_LTC: 'mfbtcbridgeLtcXXXXXXXXXXXXXXVPqpoV' },
        { BRIDGE_DOGE: 'mfbtcbridgedogeXXXXXXXXXXXXXUXTr4m' },
    ),
    'litecoin-mainnet': destinations(
        'LXChainBurnAddressXXXXXXXXXXSkrYkJ',
        { BRIDGE_BTC: 'LKLtcbridgebtcXXXXXXXXXXXXXXXA61Gk' },
        { BRIDGE_DOGE: 'LKLtcbridgedogeXXXXXXXXXXXXXX8Aknx' },
    ),
    'litecoin-testnet': destinations(
        'mxchainburnaddressXXXXXXXXXXa8EAfp',
        { BRIDGE_BTC: 'mgLtcbridgebtcXXXXXXXXXXXXXXYpo2Bo' },
        { BRIDGE_DOGE: 'mgLtcbridgedogeXXXXXXXXXXXXXZBQunc' },
    ),
    'litecoin-regtest': destinations(
        'mxchainburnaddressXXXXXXXXXXa8EAfp',
        { BRIDGE_BTC: 'mgLtcbridgebtcXXXXXXXXXXXXXXYpo2Bo' },
        { BRIDGE_DOGE: 'mgLtcbridgedogeXXXXXXXXXXXXXZBQunc' },
    ),
    'dogecoin-mainnet': destinations(
        'DChainBurnAddressXXXXXXXXXXXawc9pt',
        { BRIDGE_BTC: 'D5dogebridgebtcXXXXXXXXXXXXXVAFQt9' },
        { BRIDGE_LTC: 'D5dogebridgeLtcXXXXXXXXXXXXXUVFLyn' },
    ),
    'dogecoin-testnet': destinations(
        'nchainburnaddressXXXXXXXXXXXYKgF7W',
        { BRIDGE_BTC: 'nUdogebridgebtcXXXXXXXXXXXXXWUG2kx' },
        { BRIDGE_LTC: 'nUdogebridgeLtcXXXXXXXXXXXXXTsEz6W' },
    ),
    'dogecoin-regtest': destinations(
        'mvs8WdppEhzQLxfcYwrr1eoKA2nUFi55ff',
        { BRIDGE_BTC: 'mfdogebridgebtcXXXXXXXXXXXXXZ3agHN' },
        { BRIDGE_LTC: 'mfdogebridgeLtcXXXXXXXXXXXXXXb2E4n' },
    ),
});

/**
 * Classify a destination that no private key can spend from.
 *
 * Address comparison is exact. Base58 addresses are case-sensitive, so
 * normalizing either side could turn an ordinary address into a false match.
 *
 * @param {string} address
 * @param {string | null | undefined} chainId
 * @returns {'bridge' | 'burn' | null}
 */
export function protocolDestinationKind(address, chainId) {
    const destination = String(address || '').trim();
    const configuredDestinations = PROTOCOL_DESTINATIONS_BY_CHAIN_ID[chainId];
    if (!destination || !configuredDestinations) return null;
    for (const [role, configured] of Object.entries(configuredDestinations)) {
        if (destination !== configured) continue;
        if (role === 'BURN') return 'burn';
        if (role.startsWith('BRIDGE_')) return 'bridge';
    }
    return null;
}

/**
 * Every keyless destination in a Send recipient list, preserving row order.
 *
 * @param {string[]} destinations
 * @param {string | null | undefined} chainId
 * @returns {Array<{ index: number, kind: 'bridge' | 'burn' }>}
 */
export function protocolDestinationFindings(destinations, chainId) {
    return (Array.isArray(destinations) ? destinations : []).flatMap((address, index) => {
        const kind = protocolDestinationKind(address, chainId);
        return kind ? [{ index, kind }] : [];
    });
}
