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
    };
}
