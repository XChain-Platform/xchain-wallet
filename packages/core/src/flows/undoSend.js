// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

function assertFinite(value, name) {
    if (!Number.isFinite(value)) {
        throw new TypeError(`${name} must be finite`);
    }
}

export function undoSendRemainingSeconds({ startedAt, seconds, now }) {
    assertFinite(startedAt, 'startedAt');
    assertFinite(seconds, 'seconds');
    assertFinite(now, 'now');

    const remaining = Math.ceil((startedAt + seconds * 1000 - now) / 1000);
    return Math.min(seconds, Math.max(0, remaining));
}

export function undoSendExpired(input) {
    return undoSendRemainingSeconds(input) === 0;
}

const TICK_MS = 1000;

export function createUndoSendController({
    onTick,
    onElapsed,
    onCancel,
    now = Date.now,
    setTick = setInterval,
    clearTick = clearInterval,
} = {}) {
    let status = 'idle';
    let handle = null;

    function stopTicking() {
        if (handle !== null) {
            clearTick(handle);
            handle = null;
        }
    }

    function start(seconds) {
        if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
            throw new TypeError('seconds must be a finite number >= 0');
        }
        if (status === 'counting') {
            throw new Error('undo-send countdown already counting');
        }

        const startedAt = now();

        if (seconds === 0) {
            status = 'elapsed';
            if (onElapsed) onElapsed();
            return;
        }

        status = 'counting';
        const input = { startedAt, seconds };

        const tick = () => {
            if (status !== 'counting') return;
            const current = { ...input, now: now() };
            const remaining = undoSendRemainingSeconds(current);
            if (undoSendExpired(current)) {
                stopTicking();
                status = 'elapsed';
                if (onTick) onTick(remaining);
                if (onElapsed) onElapsed();
                return;
            }
            if (onTick) onTick(remaining);
        };

        if (onTick) onTick(undoSendRemainingSeconds({ ...input, now: now() }));
        // onTick may have cancelled synchronously
        if (status !== 'counting') return;
        handle = setTick(tick, TICK_MS);
    }

    function cancel() {
        if (status !== 'counting') return false;
        stopTicking();
        status = 'cancelled';
        if (onCancel) onCancel();
        return true;
    }

    return { start, cancel, state: () => status };
}
