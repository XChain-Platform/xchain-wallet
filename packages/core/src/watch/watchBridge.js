// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { getNativePlugin } from '../shared/nativeShell.js';

export function createWatchBridge({ getPlugin = getNativePlugin } = {}) {
    return {
        async isAvailable() {
            try {
                const plugin = getPlugin('XChainWatch', { method: 'isAvailable' });
                if (!plugin) return false;
                const answer = await plugin.isAvailable();
                return answer?.available === true;
            } catch {
                return false;
            }
        },

        async status() {
            try {
                const plugin = getPlugin('XChainWatch', { method: 'status' });
                if (!plugin) {
                    return { paired: false, installed: false, reachable: false };
                }
                const answer = await plugin.status();
                const status = {
                    paired: answer?.paired === true,
                    installed: answer?.installed === true,
                    reachable: answer?.reachable === true,
                };
                if (typeof answer?.lastSyncAt === 'number' && Number.isFinite(answer.lastSyncAt)) {
                    status.lastSyncAt = answer.lastSyncAt;
                }
                return status;
            } catch {
                return { paired: false, installed: false, reachable: false };
            }
        },

        onIntent(handler) {
            if (typeof handler !== 'function') {
                throw new TypeError('Watch intent handler must be a function');
            }

            let handle = null;
            let unsubscribed = false;
            let removed = false;

            const remove = () => {
                if (!unsubscribed || removed || !handle) return;
                try {
                    if (typeof handle.remove !== 'function') return;
                    removed = true;
                    Promise.resolve(handle.remove()).catch(() => {});
                } catch {}
            };
            const listener = (event) => {
                if (unsubscribed) return;
                try {
                    Promise.resolve(handler(event)).catch(() => {});
                } catch {}
            };

            try {
                const plugin = getPlugin('XChainWatch', { method: 'addListener' });
                if (typeof plugin?.addListener === 'function') {
                    Promise.resolve(plugin.addListener('intent', listener))
                        .then((listenerHandle) => {
                            handle = listenerHandle;
                            remove();
                        })
                        .catch(() => {});
                }
            } catch {}

            return () => {
                if (unsubscribed) return;
                unsubscribed = true;
                remove();
            };
        },
    };
}
