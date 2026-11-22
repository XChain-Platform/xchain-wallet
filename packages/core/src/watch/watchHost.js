// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { isNativeShell } from '../shared/nativeShell.js';
import { buildWatchSnapshot } from './buildWatchSnapshot.js';
import { createWatchBridge } from './watchBridge.js';
import { createWatchSync } from './watchSync.js';

export function createPendingRequestSlot({
    now = Date.now,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    onChange,
}) {
    let request = null;
    let timer;

    const disarm = () => {
        if (timer === undefined) return;
        clearTimer(timer);
        timer = undefined;
    };

    const clear = (id) => {
        if (request === null || (id !== undefined && id !== request.id)) return;
        disarm();
        request = null;
        onChange(null);
    };

    const set = (nextRequest) => {
        const hasExpiry = Object.hasOwn(nextRequest, 'expiresAt');
        let delay;
        if (hasExpiry) {
            const currentTime = now();
            if (!(nextRequest.expiresAt > currentTime)) return;
            delay = nextRequest.expiresAt - currentTime;
        }

        disarm();
        request = nextRequest;

        if (hasExpiry) {
            const armedRequest = nextRequest;
            timer = setTimer(() => {
                if (request !== armedRequest) return;
                timer = undefined;
                request = null;
                onChange(null);
            }, delay);
        }

        onChange(nextRequest);
    };

    return {
        set,
        clear,
        get: () => request,
        dispose() {
            disarm();
            request = null;
        },
    };
}

let activeHost = null;

export function publishHomeState(state) {
    activeHost?.publish(state);
}

export function setPendingRequest(request) {
    activeHost?.requests.set(request);
}

export function clearPendingRequest(id) {
    activeHost?.requests.clear(id);
}

export function stopWatchHost() {
    if (!activeHost) return;
    activeHost.sync.cancel();
    activeHost.requests.dispose();
    activeHost = null;
}

export async function startWatchHost({
    target = globalThis,
    bridge = createWatchBridge(),
    now = Date.now,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
} = {}) {
    stopWatchHost();
    try {
        if (!isNativeShell(target) || !await bridge.isAvailable()) return false;
    } catch {
        return false;
    }

    const sync = createWatchSync({ bridge, now, setTimer, clearTimer });
    let homeState;
    const send = () => {
        if (!homeState) return;
        sync.sendSnapshot(buildWatchSnapshot({
            ...homeState,
            balancesAt: homeState.balancesAt ?? homeState.balancesFetchedAt,
            session: homeState.session ?? 'unlocked',
            activeAccountId: homeState.activeAccountId ?? homeState.accountId,
            request: requests.get() ?? undefined,
        }, { now: now() }));
    };
    const requests = createPendingRequestSlot({ now, setTimer, clearTimer, onChange: send });
    activeHost = {
        sync,
        requests,
        publish(state) {
            homeState = state;
            if (state?.session === 'locked' || state?.lockReason === 'auto-lock') {
                if (requests.get()) {
                    requests.clear();
                    return;
                }
            }
            send();
        },
    };
    return true;
}
