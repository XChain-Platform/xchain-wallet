// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

const KNOWN_ACTIONS = new Set(['send', 'receive', 'execute', 'request']);

export function linkHandoffModel(search) {
    if (typeof search !== 'string') return null;

    const payload = new URLSearchParams(search).get('uri');
    if (!payload || !/^xchain:/i.test(payload)) return null;

    const envelope = payload.split('?', 1)[0];
    const parts = envelope.split('/');
    const parsedAction = (parts[1] ?? parts[0].slice('xchain:'.length)).toLowerCase();
    const action = KNOWN_ACTIONS.has(parsedAction) ? parsedAction : 'other';

    return {
        payload,
        action,
        appHref: payload,
        webHref: `/?uri=${encodeURIComponent(payload)}`,
        getHref: 'https://xchain.io/wallet/download/',
    };
}
