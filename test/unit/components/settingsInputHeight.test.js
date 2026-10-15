// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { INPUT } from '../../../packages/core/src/shared/components/settings/_settingsPrimitives.jsx';

describe('settings text and number inputs', () => {
    it('take the control height the settings dropdowns take, not a 29px padding-only box', () => {
        expect(INPUT.minHeight).toBe('var(--xc-control-h-md)');
        expect(INPUT.boxSizing).toBe('border-box');
    });
});
