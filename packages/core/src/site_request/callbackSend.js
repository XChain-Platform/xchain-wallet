// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    isRefusedCallbackHost,
    isRefusedCallbackIpv4,
} from './callbackAddress.js';
import { isRefusedCallbackIpv6 } from './callbackAddressV6.js';
import { callbackBodyFits } from './claim.js';
import { isLocalhostOrigin } from '../shared/utils/originAutoApprove.js';

export const CALLBACK_TIMEOUT_MS = 10000;

export function callbackTarget(url, { developerMode = false } = {}) {
    if (typeof url !== 'string' || url.length > 2048 || url.includes('#')) return null;

    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }

    if (parsed.username || parsed.password) return null;
    if (parsed.protocol !== 'https:'
        && !(parsed.protocol === 'http:' && developerMode && isLocalhostOrigin(url))) {
        return null;
    }

    return { href: parsed.href, hostname: parsed.hostname };
}

export function buildCallbackBody(
    { id, method, ok, result, error, state, claim },
    { hasReturn },
) {
    const body = { v: 1, id, method, ok };
    if (ok) body.result = result;
    else body.error = error;
    if (state !== undefined) body.state = state;
    if (hasReturn) body.claim = claim;
    return body;
}

function unbracket(hostname) {
    if (hostname.startsWith('[') && hostname.endsWith(']')) {
        return hostname.slice(1, -1);
    }
    return hostname;
}

function isIpv4Literal(hostname) {
    return /^\d+\.\d+\.\d+\.\d+$/.test(hostname);
}

function isRefusedAddress(address, developerMode) {
    if (typeof address !== 'string') return true;
    const options = { developerMode };
    return address.includes(':')
        ? isRefusedCallbackIpv6(address, options)
        : isRefusedCallbackIpv4(address, options);
}

export async function sendCallback(args = {}) {
    const {
        url,
        body,
        developerMode = false,
        tor = false,
        resolve,
        post,
    } = args ?? {};
    const target = callbackTarget(url, { developerMode });
    if (!target) return { sent: false, reason: 'BAD_TARGET' };

    try {
        if (!callbackBodyFits(body)) {
            return { sent: false, reason: 'RESULT_TOO_LARGE' };
        }
    } catch {
        return { sent: false, reason: 'RESULT_TOO_LARGE' };
    }

    let address;
    if (tor) {
        if (isRefusedCallbackHost(target.hostname, { tor: true })) {
            return { sent: false, reason: 'REFUSED_ADDRESS' };
        }
        address = null;
    } else {
        const literal = unbracket(target.hostname);
        if (isIpv4Literal(literal) || literal.includes(':')) {
            if (isRefusedAddress(literal, developerMode)) {
                return { sent: false, reason: 'REFUSED_ADDRESS' };
            }
            address = literal;
        } else {
            let addresses;
            try {
                addresses = await resolve(target.hostname);
            } catch {
                return { sent: false, reason: 'RESOLVE_FAILED' };
            }
            if (!Array.isArray(addresses) || addresses.length === 0) {
                return { sent: false, reason: 'RESOLVE_FAILED' };
            }
            if (addresses.some((resolved) => isRefusedAddress(resolved, developerMode))) {
                return { sent: false, reason: 'REFUSED_ADDRESS' };
            }
            [address] = addresses;
        }
    }

    try {
        const response = await post({
            href: target.href,
            address,
            body: JSON.stringify(body),
            timeoutMs: CALLBACK_TIMEOUT_MS,
            redirect: 'manual',
            credentials: 'omit',
        });
        const { status } = response;
        if (status >= 200 && status < 300) return { sent: true, status };
        return { sent: false, reason: 'HTTP_STATUS', status };
    } catch {
        return { sent: false, reason: 'NETWORK' };
    }
}
