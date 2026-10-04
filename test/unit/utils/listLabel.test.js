// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { listLabel } from '../../../packages/core/src/shared/utils/listLabel.js';

describe('listLabel', () => {
    it('includes a plain list name', () => {
        expect(listLabel(42, 'Treasury wallets')).toBe('Treasury wallets (List #42)');
    });

    it('uses the list number when no name is provided', () => {
        expect(listLabel(42)).toBe('List #42');
    });

    it('uses the list number when the name is empty', () => {
        expect(listLabel(42, '')).toBe('List #42');
    });

    it('neutralizes bidi overrides in the name', () => {
        expect(listLabel(42, 'Treasury\u202Eevil')).toBe('Treasury␦evil (List #42)');
    });

    it('keeps named labels generic and supports a kind-specific fallback', () => {
        expect(listLabel(42, 'Treasury wallets', 'Token list'))
            .toBe('Treasury wallets (List #42)');
        expect(listLabel(42, null, 'Address list')).toBe('Address list #42');
    });
});
