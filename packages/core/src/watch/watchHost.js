// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

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
    };
}
