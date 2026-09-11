// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Event sounds seam (wallet-unconfirmed-and-sounds §6 M4.1): which sound a
// notification kind resolves to under a settings record, and the wrapper
// that hands it to a shell adapter. The palette FILES are the web shell's
// (public/sounds/, checked by the smoke); this is the id-level contract.

import { describe, expect, it, vi } from 'vitest';
import {
    SOUND_NONE,
    SOUND_PALETTE,
    SOUND_FAMILIES,
    soundById,
    familyForKind,
    pickedSoundForFamily,
    resolveNotificationSound,
    withNotificationSound,
} from '../../../packages/core/src/notifications/notificationSounds.js';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

/** Every kind the six producers deliver, by `command grep "kind: '"` over core/src/notifications (I-66). */
const DELIVERED_KINDS = [
    'tx-confirmed', 'incoming-receipt', 'incoming-pending', 'incoming-message', 'order-fill', 'dispenser-fill', 'coinpay-required',
    'price-alert', 'governance-poll', 'deadline', 'deadline-summary', 'dispenser-escrow', 'coinpay-autopaid', 'coinpay-autopay-manual',
];

function settingsWith(sounds) {
    const s = createDefaultSettings();
    return { ...s, sounds: { enabled: false, perKind: {}, ...sounds } };
}

describe('the palette and the families', () => {
    it('every family default names a palette entry', () => {
        for (const f of SOUND_FAMILIES) {
            expect(soundById(f.defaultSound), `${f.key} default ${f.defaultSound}`).not.toBeNull();
        }
    });

    it('palette ids are unique and each names an mp3 file', () => {
        const ids = SOUND_PALETTE.map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const s of SOUND_PALETTE) expect(s.file).toMatch(/^[a-z]+\.mp3$/);
    });

    it('every delivered kind belongs to exactly one family, and unknown kinds to none', () => {
        const seen = new Map();
        for (const f of SOUND_FAMILIES) {
            for (const k of f.kinds) {
                expect(seen.has(k), `${k} listed twice`).toBe(false);
                seen.set(k, f.key);
            }
        }
        for (const kind of DELIVERED_KINDS) {
            expect(familyForKind(kind), `${kind} has no family`).not.toBeNull();
        }
        expect(familyForKind('not-a-kind')).toBeNull();
        expect(familyForKind(undefined)).toBeNull();
    });

    it('the family keys are exactly the ten notification flag families', () => {
        expect(SOUND_FAMILIES.map((f) => f.key).sort()).toEqual([
            'deadlines', 'dispenserEscrow', 'dispenserFills', 'governancePolls', 'incomingPending',
            'incomingReceipts', 'messages', 'orderFills', 'priceAlerts', 'txConfirmations',
        ]);
    });

    it('soundById rejects none, unknown ids and junk', () => {
        expect(soundById(SOUND_NONE)).toBeNull();
        expect(soundById('kazoo')).toBeNull();
        expect(soundById(null)).toBeNull();
        expect(soundById({ id: 'chime' })).toBeNull();
        expect(soundById('chime')).toEqual({ id: 'chime', label: 'Chime', file: 'chime.mp3' });
    });
});

describe('pickedSoundForFamily', () => {
    it('falls back to the family default when nothing is stored', () => {
        expect(pickedSoundForFamily(settingsWith({}), 'incomingPending')).toBe('pluck');
        expect(pickedSoundForFamily(createDefaultSettings(), 'incomingPending')).toBe('pluck');
        expect(pickedSoundForFamily(null, 'incomingPending')).toBe('pluck');
    });

    it('returns the stored pick, none included', () => {
        expect(pickedSoundForFamily(settingsWith({ perKind: { incomingPending: 'bong' } }), 'incomingPending')).toBe('bong');
        expect(pickedSoundForFamily(settingsWith({ perKind: { incomingPending: SOUND_NONE } }), 'incomingPending')).toBe(SOUND_NONE);
    });

    it('an id the palette no longer knows resolves to the default, not to silence', () => {
        expect(pickedSoundForFamily(settingsWith({ perKind: { incomingPending: 'retired-sound' } }), 'incomingPending')).toBe('pluck');
    });

    it('an unknown family is none', () => {
        expect(pickedSoundForFamily(settingsWith({}), 'nope')).toBe(SOUND_NONE);
    });
});

describe('resolveNotificationSound', () => {
    it('is silent by default: sounds.enabled is off out of the box (ruling I-35a)', () => {
        const s = createDefaultSettings();
        expect(s.sounds).toBeDefined();
        expect(s.sounds.enabled).toBe(false);
        expect(resolveNotificationSound(s, 'incoming-pending')).toBeNull();
        expect(resolveNotificationSound(null, 'incoming-pending')).toBeNull();
        expect(resolveNotificationSound({}, 'incoming-pending')).toBeNull();
    });

    it('with sounds on, every delivered kind resolves to its family default', () => {
        const s = settingsWith({ enabled: true });
        for (const kind of DELIVERED_KINDS) {
            const family = familyForKind(kind);
            const entry = soundById(family.defaultSound);
            expect(resolveNotificationSound(s, kind), kind).toEqual({ id: entry.id, file: entry.file });
        }
    });

    it('a per-kind pick changes only its own family', () => {
        const s = settingsWith({ enabled: true, perKind: { incomingPending: 'bong' } });
        expect(resolveNotificationSound(s, 'incoming-pending')).toEqual({ id: 'bong', file: 'bong.mp3' });
        expect(resolveNotificationSound(s, 'incoming-receipt')).toEqual({ id: 'chime', file: 'chime.mp3' });
    });

    it('none mutes one family while the master stays on', () => {
        const s = settingsWith({ enabled: true, perKind: { incomingPending: SOUND_NONE } });
        expect(resolveNotificationSound(s, 'incoming-pending')).toBeNull();
        expect(resolveNotificationSound(s, 'incoming-receipt')).not.toBeNull();
    });

    it('master off silences every family whatever is picked', () => {
        const s = settingsWith({ enabled: false, perKind: { incomingPending: 'bong', incomingReceipts: 'chime' } });
        for (const kind of DELIVERED_KINDS) expect(resolveNotificationSound(s, kind), kind).toBeNull();
    });

    it('a kind no picker can reach gets no sound even with the master on', () => {
        expect(resolveNotificationSound(settingsWith({ enabled: true }), 'some-new-kind')).toBeNull();
    });

    it('only a literal true enables: a truthy non-boolean is still off', () => {
        expect(resolveNotificationSound(settingsWith({ enabled: 'yes' }), 'incoming-pending')).toBeNull();
    });
});

describe('withNotificationSound', () => {
    const payload = { kind: 'incoming-pending', title: 'Incoming on Litecoin', body: 'pending' };

    it('requires both dependencies', () => {
        expect(() => withNotificationSound(null, () => ({}))).toThrow(/notify/);
        expect(() => withNotificationSound(() => {}, null)).toThrow(/getSettings/);
    });

    it('adds the resolved sound and keeps every other field', async () => {
        const notify = vi.fn();
        const wrapped = withNotificationSound(notify, async () => settingsWith({ enabled: true }));
        await wrapped({ ...payload, data: { txHash: 'ab' } });
        expect(notify).toHaveBeenCalledTimes(1);
        expect(notify.mock.calls[0][0]).toEqual({ ...payload, data: { txHash: 'ab' }, sound: { id: 'pluck', file: 'pluck.mp3' } });
    });

    it('re-reads settings per delivery, so a toggle takes effect on the next event', async () => {
        const notify = vi.fn();
        let enabled = true;
        const wrapped = withNotificationSound(notify, () => settingsWith({ enabled }));
        await wrapped(payload);
        enabled = false;
        await wrapped(payload);
        expect(notify.mock.calls[0][0].sound).toEqual({ id: 'pluck', file: 'pluck.mp3' });
        expect(notify.mock.calls[1][0].sound).toBeNull();
    });

    it('a failed settings read costs the sound, never the notification', async () => {
        const notify = vi.fn();
        const wrapped = withNotificationSound(notify, async () => { throw new Error('vault closed'); });
        await expect(wrapped(payload)).resolves.toBeUndefined();
        expect(notify).toHaveBeenCalledTimes(1);
        expect(notify.mock.calls[0][0]).toEqual({ ...payload, sound: null });
    });

    it('returns what the adapter returns, so an async adapter is awaited by the producer', async () => {
        const wrapped = withNotificationSound(async () => 'delivered', () => settingsWith({}));
        await expect(wrapped(payload)).resolves.toBe('delivered');
    });
});
