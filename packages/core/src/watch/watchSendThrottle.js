// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

export function createSendThrottle({
    send,
    intervalMs = 30000,
    now = Date.now,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
}) {
    let lastSendAt = null;
    let timer = null;
    let heldValue;
    let hasHeldValue = false;

    function disarm() {
        if (timer === null) return;
        clearTimer(timer);
        timer = null;
    }

    function dropHeldValue() {
        heldValue = undefined;
        hasHeldValue = false;
    }

    function sendNow(value) {
        lastSendAt = now();
        try {
            Promise.resolve(send(value)).catch(() => {});
        } catch {}
    }

    function offer(value, { urgent = false } = {}) {
        const offeredAt = now();
        if (urgent || lastSendAt === null || offeredAt - lastSendAt >= intervalMs) {
            disarm();
            dropHeldValue();
            sendNow(value);
            return;
        }

        heldValue = value;
        hasHeldValue = true;
        if (timer !== null) return;

        timer = setTimer(() => {
            timer = null;
            if (!hasHeldValue) return;
            const valueToSend = heldValue;
            dropHeldValue();
            sendNow(valueToSend);
        }, Math.max(0, lastSendAt + intervalMs - offeredAt));
    }

    function cancel() {
        disarm();
        dropHeldValue();
    }

    return { offer, cancel };
}
