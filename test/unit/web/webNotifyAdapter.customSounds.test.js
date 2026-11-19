// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const playCustomSound = vi.hoisted(() => vi.fn());
vi.mock('../../../packages/core/src/notifications/customSounds.js', async (importOriginal) => ({
    ...(await importOriginal()),
    playCustomSound,
}));

const { createWebNotifyAdapter } = await import('../../../packages/web/src/notifications/webNotifyAdapter.js');

describe('web custom sound playback', () => {
    beforeEach(() => playCustomSound.mockResolvedValue(true));

    it('loads custom data for previews and delivered notifications', () => {
        const notify = createWebNotifyAdapter();
        expect(notify.playSound('custom:preview')).toBe(true);
        notify({ kind: 'incoming-message', title: 'Message', body: 'New message', sound: { id: 'custom:delivery', custom: true } });
        expect(playCustomSound).toHaveBeenNthCalledWith(1, 'custom:preview');
        expect(playCustomSound).toHaveBeenNthCalledWith(2, 'custom:delivery');
    });
});
