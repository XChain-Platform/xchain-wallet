// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: MIT

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

const refusedReturn = () => ({
    kind: 'refused',
    error: {
        ok: false,
        error: 'NO_PENDING_REQUEST',
    },
});

export function classifyReturn(envelope, pending) {
    if (pending !== null) {
        const matches = pending?.id === envelope?.id
            && (!hasOwn(envelope, 'method') || envelope.method === pending.method)
            && (!hasOwn(envelope, 'state') || envelope.state === pending.state);

        return matches
            ? { kind: 'solicited', envelope }
            : refusedReturn();
    }

    const address = envelope?.result?.address;
    if (
        envelope?.method === 'login'
        && envelope.ok === true
        && typeof address === 'string'
        && address.length > 0
    ) {
        return {
            kind: 'unsolicited-login',
            envelope,
            solicited: false,
            address,
        };
    }

    return refusedReturn();
}

export function cleanReturnHref(href) {
    const fragmentIndex = href.indexOf('#');
    return fragmentIndex >= 0 && href.startsWith('#xchain=', fragmentIndex)
        ? href.slice(0, fragmentIndex)
        : href;
}
