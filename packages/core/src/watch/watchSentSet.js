// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

export function createWatchSentSet() {
    const sent = {
        image: new Set(),
        detail: new Set(),
    };
    let hasAppVersion = false;
    let appVersion;

    const hashesFor = (kind) => {
        if (kind !== 'image' && kind !== 'detail') {
            throw new TypeError('Watch sent kind must be image or detail');
        }
        return sent[kind];
    };

    const clear = () => {
        sent.image.clear();
        sent.detail.clear();
    };

    return {
        has(kind, hash) {
            return hashesFor(kind).has(hash);
        },
        add(kind, hash) {
            hashesFor(kind).add(hash);
        },
        clear,
        noteAppVersion(version) {
            if (hasAppVersion && version === appVersion) return false;

            appVersion = version;
            hasAppVersion = true;
            clear();
            return true;
        },
    };
}
