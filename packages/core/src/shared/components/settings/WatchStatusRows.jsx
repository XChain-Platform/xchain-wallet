// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

export function watchStatusHint({ paired, installed, reachable }, platform) {
    if (platform !== 'ios' && platform !== 'android') return null;

    if (platform === 'ios' && !paired) return 'pairWatchIos';
    if (platform === 'ios' && !installed) return 'installWatchIos';
    if (platform === 'android' && (!paired || !installed)) return 'installWatchAndroid';
    if (!reachable) return 'bringWatchNear';

    return null;
}
