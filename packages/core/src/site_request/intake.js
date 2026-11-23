// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createLinkSlot } from './linkSlot.js';
import { createLinkThrottle } from './linkThrottle.js';

export function createSiteRequestIntake({
    now = Date.now,
    limit = 5,
    windowMs = 60000,
} = {}) {
    const slot = createLinkSlot({ now });
    const throttle = createLinkThrottle({ limit, windowMs, now });
    let heldEnvelope = null;
    let parked = false;

    const clearHeld = () => {
        heldEnvelope = null;
        parked = false;
    };

    const recheckHeld = () => {
        const checked = slot.recheck();
        if (!checked.ok) {
            if (checked.reason !== 'empty') clearHeld();
            return checked;
        }
        return { ok: true };
    };

    return {
        offer(envelope, {
            approvalOpen = false,
            sendHeld = false,
            locked = false,
        } = {}) {
            const throttled = throttle.take();
            if (!throttled.ok) {
                return {
                    ok: false,
                    reason: 'throttled',
                    retryInMs: throttled.retryInMs,
                };
            }

            const offered = slot.offer(envelope, { approvalOpen, sendHeld });
            if (!offered.ok) return offered;

            heldEnvelope = { ...envelope };
            parked = locked;
            return { ok: true, parked };
        },

        current() {
            if (heldEnvelope === null) return null;
            return { envelope: { ...heldEnvelope }, parked };
        },

        unlock() {
            const checked = recheckHeld();
            if (!checked.ok) return checked;

            parked = false;
            return { ok: true, envelope: { ...heldEnvelope } };
        },

        recheck() {
            const checked = recheckHeld();
            if (!checked.ok) return checked;
            if (parked) return { ok: false, reason: 'locked' };
            return { ok: true, envelope: { ...heldEnvelope } };
        },

        release(id) {
            if (!slot.release(id)) return false;
            clearHeld();
            return true;
        },
    };
}
