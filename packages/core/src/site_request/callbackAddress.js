// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

const DECIMAL_OCTET = /^(0|[1-9][0-9]{0,2})$/;

function parseIpv4(ip) {
    if (typeof ip !== 'string') return null;

    const parts = ip.split('.');
    if (parts.length !== 4 || parts.some((part) => !DECIMAL_OCTET.test(part))) {
        return null;
    }

    const octets = parts.map(Number);
    return octets.every((octet) => octet <= 255) ? octets : null;
}

function isBracketedIpv6(host) {
    if (!host.startsWith('[') || !host.endsWith(']')) return false;

    try {
        const parsed = new URL(`http://${host}/`);
        return parsed.hostname.startsWith('[') && parsed.hostname.endsWith(']');
    } catch {
        return false;
    }
}

export function isRefusedCallbackIpv4(ip, { developerMode = false } = {}) {
    const octets = parseIpv4(ip);
    if (!octets) return true;

    const [first, second, third] = octets;
    if (first === 127) return !developerMode;

    return first === 0
        || first === 10
        || (first === 100 && second >= 64 && second <= 127)
        || (first === 169 && second === 254)
        || (first === 172 && second >= 16 && second <= 31)
        || (first === 192 && second === 0 && third === 0)
        || (first === 192 && second === 168)
        || (first === 198 && (second === 18 || second === 19))
        || first >= 224;
}

export function isRefusedCallbackHost(host, { tor = false } = {}) {
    if (!tor || typeof host !== 'string') return false;
    return parseIpv4(host) !== null || isBracketedIpv6(host);
}
