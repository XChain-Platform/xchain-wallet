// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { createWatchSentSet } from '../../../packages/core/src/watch/watchSentSet.js';

describe('createWatchSentSet', () => {
    it('records image and detail hashes independently', () => {
        const sent = createWatchSentSet();

        expect(sent.has('image', 'same-hash')).toBe(false);
        expect(sent.has('detail', 'same-hash')).toBe(false);

        sent.add('image', 'same-hash');
        expect(sent.has('image', 'same-hash')).toBe(true);
        expect(sent.has('detail', 'same-hash')).toBe(false);

        sent.add('detail', 'same-hash');
        expect(sent.has('image', 'same-hash')).toBe(true);
        expect(sent.has('detail', 'same-hash')).toBe(true);
    });

    it('clears every recorded hash', () => {
        const sent = createWatchSentSet();
        sent.add('image', 'icon-hash');
        sent.add('detail', 'token-hash');

        sent.clear();

        expect(sent.has('image', 'icon-hash')).toBe(false);
        expect(sent.has('detail', 'token-hash')).toBe(false);
    });

    it('clears hashes on the first app version and each version change', () => {
        const sent = createWatchSentSet();
        sent.add('image', 'before-first-note');

        expect(sent.noteAppVersion('1.0.0')).toBe(true);
        expect(sent.has('image', 'before-first-note')).toBe(false);

        sent.add('detail', 'kept-for-same-version');
        expect(sent.noteAppVersion('1.0.0')).toBe(false);
        expect(sent.has('detail', 'kept-for-same-version')).toBe(true);

        expect(sent.noteAppVersion('1.0.1')).toBe(true);
        expect(sent.has('detail', 'kept-for-same-version')).toBe(false);

        sent.clear();
        expect(sent.noteAppVersion('1.0.1')).toBe(false);
    });

    it.each([
        ['has', (sent, kind) => sent.has(kind, 'hash')],
        ['add', (sent, kind) => sent.add(kind, 'hash')],
    ])('throws a TypeError when %s receives an unsupported kind', (_name, operation) => {
        const sent = createWatchSentSet();

        const hostileKind = { toString: () => { throw new Error('do not coerce'); } };
        for (const kind of ['artwork', '', undefined, null, hostileKind]) {
            expect(() => operation(sent, kind)).toThrow(TypeError);
        }
    });
});
