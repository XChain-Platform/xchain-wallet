// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// A private key copied from Show private key stays on the clipboard for the
// whole expiry window, and a Lock inside that window left it there: the next
// paste anywhere, wallet locked, still produced the key. Leaving the unlocked
// session clears a sensitive copy whose timer is still running.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    SENSITIVE_CLIP_TTL_SECONDS,
    clearSensitiveCopy,
    configureClipboardAutoClear,
    copyText,
} from '../../../packages/core/src/shared/clipboard.js';

const KEY = 'private-key-under-test';

function browserEnv() {
    const listeners = new Set();
    const env = {
        value: '',
        writes: /** @type {string[]} */ ([]),
        navigator: { clipboard: {
            writeText: async (text) => { env.writes.push(text); env.value = text; },
            readText: async () => env.value,
            addEventListener: (type, fn) => { if (type === 'clipboardchange') listeners.add(fn); },
            removeEventListener: (type, fn) => { if (type === 'clipboardchange') listeners.delete(fn); },
        } },
        replace(text) { env.value = text; for (const fn of listeners) fn(); },
    };
    return env;
}

afterEach(() => {
    vi.useRealTimers();
    configureClipboardAutoClear(SENSITIVE_CLIP_TTL_SECONDS);
});

describe('clearSensitiveCopy', () => {
    it('clears a sensitive copy before its expiry and disarms the timer', async () => {
        vi.useFakeTimers();
        const env = browserEnv();
        await copyText(KEY, { sensitive: true, ttlSeconds: 60, env });

        await expect(clearSensitiveCopy({ env })).resolves.toBe(true);
        expect(env.value).not.toBe(KEY);
        const writes = env.writes.length;
        await vi.advanceTimersByTimeAsync(60_000);
        expect(env.writes.length).toBe(writes);
    });

    it('leaves a value another app copied afterwards', async () => {
        const env = browserEnv();
        await copyText(KEY, { sensitive: true, ttlSeconds: 60, env });
        env.replace('copied elsewhere');

        await expect(clearSensitiveCopy({ env })).resolves.toBe(false);
        expect(env.value).toBe('copied elsewhere');
    });

    it('leaves plain copies and copies kept on purpose', async () => {
        const env = browserEnv();
        await copyText('an address', { env });
        await expect(clearSensitiveCopy({ env })).resolves.toBe(false);
        expect(env.value).toBe('an address');

        configureClipboardAutoClear(0);
        await copyText(KEY, { sensitive: true, env });
        await expect(clearSensitiveCopy({ env })).resolves.toBe(false);
        expect(env.value).toBe(KEY);
    });
});

describe('every interactive shell clears it as the session leaves unlocked', () => {
    it.each([
        'packages/web/src/App.jsx',
        'packages/desktop/renderer/App.jsx',
        'packages/extension/src/popup/App.jsx',
    ])('%s', (file) => {
        const source = readFileSync(join(process.cwd(), file), 'utf8');
        expect(source).toContain("import { clearSensitiveCopy } from '@xchain-wallet/core/shared/clipboard.js';");
        expect(source).toMatch(
            /if \(status\.state !== 'unlocked'\) \{[\s\S]{0,500}?void clearSensitiveCopy\(\);/,
        );
    });
});
