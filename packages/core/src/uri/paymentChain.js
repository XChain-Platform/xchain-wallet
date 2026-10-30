// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The chain a payment request pays on. A link that names no chain still names
// one through its address when only one supported chain accepts that address,
// so a scanned code, an opened link and a pasted link all land on that chain.

import { isValidAddressForChain } from '../shared/utils/addressValidation.js';

const LOCALLY_VALIDATED_COINS = new Set(['bitcoin', 'litecoin', 'dogecoin']);

function descriptorAcceptsAddress(descriptor, address) {
    if (!LOCALLY_VALIDATED_COINS.has(descriptor.coin)) return true;
    return isValidAddressForChain(address, descriptor.coin, descriptor.networkKind);
}

/**
 * Resolve the chain for a payment request's address.
 *
 * `valid` is false when the named chain is unknown, its URI scheme differs
 * from `scheme`, or no eligible chain accepts the address. `chainId` is the
 * one chain the request pays on, or undefined when several chains accept the
 * address (legacy testnet and regtest formats are shared).
 *
 * @param {{ address: string, chainId?: string, scheme?: string, chainRegistry: any }} args
 * @returns {{ valid: boolean, chainId?: string }}
 */
export function resolvePaymentChain({ address, chainId, scheme, chainRegistry }) {
    if (chainId !== undefined) {
        const descriptor = chainRegistry.get(chainId);
        if (!descriptor || (scheme && descriptor.uriScheme.toLowerCase() !== scheme)) {
            return { valid: false };
        }
        return descriptorAcceptsAddress(descriptor, address)
            ? { valid: true, chainId }
            : { valid: false };
    }

    const eligible = chainRegistry.supportedChains().filter((descriptor) => (
        !scheme || descriptor.uriScheme.toLowerCase() === scheme
    ));
    const locallyValidated = eligible.filter((descriptor) => (
        LOCALLY_VALIDATED_COINS.has(descriptor.coin)
    ));
    if (locallyValidated.length === 0) {
        return { valid: eligible.length > 0 };
    }
    const descriptors = locallyValidated.filter((descriptor) => (
        descriptorAcceptsAddress(descriptor, address)
    ));
    if (descriptors.length === 0) return { valid: false };
    return {
        valid: true,
        chainId: descriptors.length === 1 ? descriptors[0].id : undefined,
    };
}
