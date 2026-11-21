// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { isDemoWallet } from '../flows/demoMode.js';
import { t } from '../i18n/index.js';
import { resolveWatchSettings } from '../schemas/settings.js';
import { getNativePlugin } from '../shared/nativeShell.js';

export const HOME_BALANCES_PUBLISHED_EVENT = 'xc:home-balances-published';

const SYNC_EVENTS = [
    'xc:session-changed',
    'xc:settings-changed',
    HOME_BALANCES_PUBLISHED_EVENT,
];

export function activityCheckTargets(entries) {
    const seen = new Set();
    const targets = [];

    for (const entry of entries) {
        const { address, explorerBaseUrl } = entry;
        const key = JSON.stringify([address, explorerBaseUrl]);
        if (seen.has(key)) continue;
        seen.add(key);

        const baseUrl = explorerBaseUrl.replace(/\/+$/, '');
        const target = {
            address,
            url: `${baseUrl}/address/${encodeURIComponent(address)}`,
            // These are explorer JSON paths, not copy keys.
            confirmedPath: ['balances', 'confirmed'].join('.'),
            pendingPath: ['balances', 'pending'].join('.'),
        };
        const confirmed = entry.confirmed ?? entry.balances?.confirmed;
        const pending = entry.pending ?? entry.balances?.pending;
        if (typeof confirmed === 'string') target.confirmed = confirmed;
        if (typeof pending === 'string') target.pending = pending;
        targets.push(target);
    }

    return targets;
}

export function buildActivityCheckConfig({
    entries = [],
    settings = {},
    walletId,
    translate = t,
    demoWallet = isDemoWallet,
} = {}) {
    return {
        enabled: resolveWatchSettings(settings).backgroundActivityCheck === true
            && !demoWallet(walletId),
        targets: activityCheckTargets(entries),
        notice: {
            title: translate('watch.newActivity.title'),
            body: translate('watch.newActivity.body'),
        },
        openOnPhoneTitle: translate('watch.openOnPhone'),
    };
}

async function pushActivityCheckConfig(state, getPlugin) {
    try {
        const plugin = getPlugin('XChainActivity', { method: 'setActivityCheck' });
        if (!plugin) return false;
        await plugin.setActivityCheck({ json: JSON.stringify(buildActivityCheckConfig(state)) });
        return true;
    } catch {
        return false;
    }
}

export function startActivityCheckSync({
    target = globalThis,
    getNativePlugin: getPlugin = getNativePlugin,
    readState = () => ({}),
} = {}) {
    const sync = () => {
        try {
            return pushActivityCheckConfig(readState(), getPlugin);
        } catch {
            return Promise.resolve(false);
        }
    };

    for (const eventName of SYNC_EVENTS) target.addEventListener(eventName, sync);
    void sync();

    return () => {
        for (const eventName of SYNC_EVENTS) target.removeEventListener(eventName, sync);
    };
}
