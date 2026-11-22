/** @vitest-environment node */

// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { retainUpdaterEvent } from '../../../packages/desktop/main/updaterState/retainUpdaterEvent.js';

const ev = (type, extra = {}) => ({ type, ...extra });

function replay(events) {
    return events.reduce((slot, event) => retainUpdaterEvent(slot, event), null);
}

describe('retained updater event', () => {
    it('keeps a standing offer through a failed manual check', () => {
        const offer = ev('available', { info: { version: '0.2.0' } });
        const slot = replay([
            offer,
            ev('checking', { userInitiated: true }),
            ev('error', { userInitiated: true, info: { message: 'offline' } }),
        ]);
        expect(slot).toBe(offer);
    });

    it('keeps a verified update ready to restart through a failed check', () => {
        const ready = ev('ready', { info: { version: '0.2.0' } });
        expect(replay([ready, ev('checking'), ev('error')])).toBe(ready);
    });

    it('keeps download progress and a rejected download through check results', () => {
        const progress = ev('progress', { info: { percent: 40 } });
        expect(replay([progress, ev('checking')])).toBe(progress);
        const rejected = ev('rejected', { info: { reason: 'hash' } });
        expect(replay([rejected, ev('error')])).toBe(rejected);
        const verifying = ev('verifying');
        expect(replay([ev('downloaded'), verifying, ev('error')])).toBe(verifying);
    });

    it('lets a not-available result clear a standing offer', () => {
        const none = ev('not-available');
        expect(replay([ev('available'), ev('checking'), none])).toBe(none);
    });

    it('lets newer offer and download events replace the slot', () => {
        const newer = ev('available', { info: { version: '0.3.0' } });
        expect(replay([ev('available', { info: { version: '0.2.0' } }), newer])).toBe(newer);
        for (const type of ['progress', 'downloaded', 'verifying', 'ready', 'rejected']) {
            const next = ev(type);
            expect(retainUpdaterEvent(ev('available'), next)).toBe(next);
        }
    });

    it('retains check results when no update work stands', () => {
        const error = ev('error');
        const checking = ev('checking');
        expect(retainUpdaterEvent(null, error)).toBe(error);
        expect(retainUpdaterEvent(null, checking)).toBe(checking);
        expect(retainUpdaterEvent(ev('not-available'), error)).toBe(error);
        expect(retainUpdaterEvent(ev('checking'), error)).toBe(error);
    });

    it('does not mutate either event', () => {
        const offer = Object.freeze(ev('available'));
        const error = Object.freeze(ev('error'));
        expect(() => retainUpdaterEvent(offer, error)).not.toThrow();
    });
});
