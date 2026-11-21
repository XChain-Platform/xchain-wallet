// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { familyForKind } from '@xchain-wallet/core/notifications/notificationSounds.js';
import { getNativePlugin } from '@xchain-wallet/core/shared/nativeShell.js';

export const NATIVE_NOTIFY_PLUGIN = 'XChainNotify';
export const NATIVE_NOTIFY_ACTION_EVENT = 'action';

function nativePayload(payload = {}, at) {
    const family = familyForKind(payload.kind)?.key || payload.family || 'alert';
    const options = {
        id: payload.id || payload.kind,
        title: payload.title,
        body: payload.body,
        family,
        sound: payload.sound?.file ? payload.sound.id : null,
        category: payload.category || 'alert',
        threadId: payload.threadId || family,
        actions: Array.isArray(payload.actions) ? payload.actions : [],
    };
    if (at !== undefined) options.at = at;
    return options;
}

export function createNativeNotifyAdapter() {
    const plugin = getNativePlugin(NATIVE_NOTIFY_PLUGIN, { method: 'post' });
    const handlers = new Set();

    if (typeof plugin?.addListener === 'function') {
        try {
            Promise.resolve(plugin.addListener(NATIVE_NOTIFY_ACTION_EVENT, (event) => {
                for (const handler of handlers) {
                    try { handler(event); } catch { continue; }
                }
            })).catch(() => {});
        } catch {}
    }

    function notify(payload) {
        return plugin ? plugin.post(nativePayload(payload)) : false;
    }

    notify.schedule = (payload, at = payload?.at) => (
        plugin && typeof plugin.schedule === 'function'
            ? plugin.schedule(nativePayload(payload, at))
            : false
    );
    notify.cancel = (id) => (
        plugin && typeof plugin.cancel === 'function' ? plugin.cancel({ id }) : false
    );
    notify.onAction = (handler) => {
        if (typeof handler !== 'function') return () => {};
        handlers.add(handler);
        return () => handlers.delete(handler);
    };

    return notify;
}
