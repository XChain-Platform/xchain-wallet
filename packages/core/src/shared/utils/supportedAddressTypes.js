// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The address types a picker may offer for one chain: the registry's list
// narrowed to what the installed SDK can generate. The host answers through
// `messaging.getSupportedAddressTypes`; a shell without it, a host that cannot
// ask yet, and a failed call all leave the full registry list so a picker never
// goes empty because of the check.

const SUPPORT_REPLY_WAIT_MS = 1000;

/**
 * @param {any} messaging
 * @param {{ id: string, addressTypes: string[] }|null|undefined} descriptor
 * @returns {Promise<string[]>}
 */
export async function loadSupportedAddressTypes(messaging, descriptor) {
    const all = Array.isArray(descriptor?.addressTypes) ? descriptor.addressTypes : [];
    if (!descriptor?.id || typeof messaging?.getSupportedAddressTypes !== 'function') return all;
    try {
        // A host that never answers must not hold the screen: after the wait the
        // registry list stands.
        let timer;
        const reply = await Promise.race([
            messaging.getSupportedAddressTypes(descriptor.id),
            new Promise((resolve) => { timer = setTimeout(() => resolve(null), SUPPORT_REPLY_WAIT_MS); }),
        ]).finally(() => clearTimeout(timer));
        const supported = Array.isArray(reply?.supported) ? reply.supported : null;
        if (!supported) return all;
        const kept = all.filter((type) => supported.includes(type));
        return kept.length > 0 ? kept : all;
    } catch {
        return all;
    }
}

/**
 * The type to use: the wanted one when offered, otherwise the chain default
 * when offered, otherwise the first offered type.
 *
 * @param {string|undefined|null} wanted
 * @param {string[]} offered
 * @param {string|undefined|null} fallback
 * @returns {string}
 */
export function offeredAddressType(wanted, offered, fallback) {
    if (wanted && offered.includes(wanted)) return wanted;
    if (fallback && offered.includes(fallback)) return fallback;
    return offered[0] || wanted || fallback || '';
}
