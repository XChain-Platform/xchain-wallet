// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    InvalidBackupPointerError,
    parseBackupPointer,
} from '../../../packages/core/src/uri/backupPointer.js';

describe('backup pointer low-coverage branches', () => {
    it.each([
        ['xchain-backup', /missing scheme/],
        ['xchain-backup:?loc=here', /missing version/],
        ['xchain-backup:1?loc=%ZZ', /percent-encoding/],
        ['xchain-backup:1?loc', /empty "loc"/],
    ])('rejects malformed pointer boundary %#', (uri, message) => {
        expect(() => parseBackupPointer(uri)).toThrow(InvalidBackupPointerError);
        expect(() => parseBackupPointer(uri)).toThrow(message);
    });

    it('ignores empty pairs and keeps the first duplicate parameter', () => {
        const pointer = parseBackupPointer(
            'xchain-backup:1?&loc=first&flag&loc=second&&name=Primary',
        );

        expect(pointer.location).toBe('first');
        expect(pointer.name).toBe('Primary');
    });
});
