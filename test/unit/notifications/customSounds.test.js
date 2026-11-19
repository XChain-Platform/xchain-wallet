// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    CUSTOM_SOUND_MAX_BYTES,
    isCustomSoundId,
    validateCustomSoundFile,
} from '../../../packages/core/src/notifications/customSounds.js';
import { resolveNotificationSound } from '../../../packages/core/src/notifications/notificationSounds.js';

function audioFile({ name = 'tone.mp3', type = 'audio/mpeg', size = 100, duration = 2, decodeFails = false } = {}) {
    const bytes = new ArrayBuffer(16);
    const file = { name, type, size, arrayBuffer: vi.fn(async () => bytes) };
    class AudioContext {
        async decodeAudioData() {
            if (decodeFails) throw new Error('decode failed');
            return { duration };
        }
        async close() {}
    }
    return { file, env: { AudioContext } };
}

describe('custom sound validation', () => {
    it('accepts a decodable supported audio file', async () => {
        const { file, env } = audioFile({ duration: 4.25 });
        await expect(validateCustomSoundFile(file, env)).resolves.toMatchObject({
            duration: 4.25,
            mimeType: 'audio/mpeg',
        });
        expect(file.arrayBuffer).toHaveBeenCalledOnce();
    });

    it('rejects a file that has an audio extension but does not decode as audio', async () => {
        const { file, env } = audioFile({ decodeFails: true });
        await expect(validateCustomSoundFile(file, env)).rejects.toThrow('could not be decoded as audio');
    });

    it('rejects audio longer than 30 seconds', async () => {
        const { file, env } = audioFile({ duration: 30.01 });
        await expect(validateCustomSoundFile(file, env)).rejects.toThrow('30 seconds or shorter');
    });

    it('rejects a file over 2 MB before reading it', async () => {
        const { file, env } = audioFile({ size: CUSTOM_SOUND_MAX_BYTES + 1 });
        await expect(validateCustomSoundFile(file, env)).rejects.toThrow('2 MB or smaller');
        expect(file.arrayBuffer).not.toHaveBeenCalled();
    });

    it('recognises only non-empty custom sound ids', () => {
        expect(isCustomSoundId('custom:abc')).toBe(true);
        expect(isCustomSoundId('custom:')).toBe(false);
        expect(isCustomSoundId('bell')).toBe(false);
    });

    it('keeps a selected custom id in the notification playback payload', () => {
        const settings = {
            sounds: { enabled: true, perKind: { messages: 'custom:message' } },
        };
        expect(resolveNotificationSound(settings, 'incoming-message')).toEqual({
            id: 'custom:message',
            custom: true,
        });
    });
});
