// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { vaultErrorKind } from '../../../packages/core/src/storage/backend.js';

describe('storage backend uncovered branches', () => {
    it('classifies a realm-neutral corrupt error name', () => {
        expect(vaultErrorKind({ name: 'VaultCorruptError' })).toBe('corrupt');
    });

    it.each([null, undefined, new Error('unrelated'), { name: 'OtherError' }])(
        'returns null for an unrelated value',
        (error) => {
            expect(vaultErrorKind(error)).toBeNull();
        },
    );
});
