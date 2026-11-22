// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { createSendThrottle } from './watchSendThrottle.js';
import { createWatchSentSet } from './watchSentSet.js';

function canonicalize(value, omitKeys, topLevel = false) {
    if (Array.isArray(value)) return value.map((entry) => canonicalize(entry, omitKeys));
    if (!value || typeof value !== 'object') return value;

    const entries = Object.keys(value)
        .filter((key) => !topLevel || !omitKeys.has(key))
        .sort()
        .map((key) => [key, canonicalize(value[key], omitKeys)]);
    return Object.fromEntries(entries);
}

/**
 * Hash JSON-compatible content with stable object-key ordering.
 *
 * @param {unknown} value
 * @param {string[]} [omitKeys]
 * @returns {string}
 */
export function watchContentHash(value, omitKeys = []) {
    const canonicalJson = JSON.stringify(canonicalize(value, new Set(omitKeys), true));
    return bytesToHex(sha256(new TextEncoder().encode(canonicalJson)));
}

export function createWatchSync({
    bridge,
    intervalMs = 30000,
    now = Date.now,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
}) {
    const sent = createWatchSentSet();
    let latestSnapshot;
    let lastSnapshotHash;
    let reachable;
    let previousSettingsHash;
    let previousRequestHash;

    const throttle = createSendThrottle({
        intervalMs,
        now,
        setTimer,
        clearTimer,
        send({ snapshot, hash }) {
            lastSnapshotHash = hash;
            return bridge.sendSnapshot(snapshot);
        },
    });

    function sendSnapshot(snapshot, options = {}) {
        latestSnapshot = snapshot;
        const hash = watchContentHash(snapshot, ['builtAt']);
        const settingsHash = watchContentHash({ settings: snapshot?.settings });
        const requestHash = watchContentHash({ request: snapshot?.request });
        const settingsChanged = previousSettingsHash !== undefined
            && settingsHash !== previousSettingsHash;
        const requestChanged = previousRequestHash !== undefined
            && requestHash !== previousRequestHash;
        previousSettingsHash = settingsHash;
        previousRequestHash = requestHash;
        if (!options.force && hash === lastSnapshotHash) {
            throttle.cancel();
            return false;
        }
        throttle.offer({ snapshot, hash }, {
            urgent: settingsChanged || requestChanged
                || options.settingsChanged === true || options.requestChanged === true,
        });
        return true;
    }

    function sendOnce(kind, value, send) {
        const hash = kind === 'image' ? value?.hash : watchContentHash(value);
        if (typeof hash !== 'string' || !hash || sent.has(kind, hash)) return false;
        sent.add(kind, hash);
        try {
            Promise.resolve(send(value)).catch(() => {});
        } catch {}
        return true;
    }

    function resend() {
        if (latestSnapshot !== undefined) sendSnapshot(latestSnapshot, { force: true });
    }

    return {
        sendSnapshot,
        sendImage: (image) => sendOnce('image', image, bridge.sendImage.bind(bridge)),
        sendDetail: (detail) => sendOnce('detail', detail, bridge.sendDetail.bind(bridge)),
        refresh() {
            sent.clear();
            resend();
        },
        watchState(state) {
            return sent.noteAppVersion(state?.appVersion);
        },
        setReachable(nextReachable) {
            const returned = reachable === false && nextReachable === true;
            reachable = nextReachable;
            if (returned) resend();
        },
        removeWatchData() {
            sent.clear();
            throttle.cancel();
            lastSnapshotHash = undefined;
            try {
                return Promise.resolve(bridge.removeWatchData()).catch(() => false);
            } catch {
                return Promise.resolve(false);
            }
        },
        cancel: throttle.cancel,
    };
}
