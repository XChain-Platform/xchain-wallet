// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

export function createLinkSlot({ now = Date.now } = {}) {
    let held = null;
    const accepted = new Map();

    const dropExpired = (currentTime) => {
        for (const [id, exp] of accepted) {
            if (exp <= currentTime) accepted.delete(id);
        }
        if (held !== null && held.exp <= currentTime) held = null;
    };

    return {
        offer(request, { approvalOpen = false, sendHeld = false } = {}) {
            const id = request?.id;
            if (typeof id !== 'string' || id.length === 0) {
                throw new TypeError('Link request id must be a non-empty string');
            }

            const exp = request?.exp;
            if (typeof exp !== 'number' || !Number.isFinite(exp)) {
                throw new TypeError('Link request exp must be a finite number');
            }

            const currentTime = now();
            dropExpired(currentTime);

            if (exp <= currentTime) return { ok: false, reason: 'expired' };
            if (accepted.has(id)) return { ok: false, reason: 'reused' };
            if (held !== null) return { ok: false, reason: 'busy' };
            if (approvalOpen || sendHeld) return { ok: false, reason: 'covered' };

            held = { id, exp };
            accepted.set(id, exp);
            return { ok: true };
        },

        current() {
            return held === null ? null : { ...held };
        },

        recheck() {
            const hadHeld = held !== null;
            dropExpired(now());
            if (!hadHeld) return { ok: false, reason: 'empty' };
            if (held === null) return { ok: false, reason: 'expired' };
            return { ok: true };
        },

        release(id) {
            if (held === null || held.id !== id) return false;
            held = null;
            return true;
        },

        remembered() {
            dropExpired(now());
            return accepted.size;
        },
    };
}
