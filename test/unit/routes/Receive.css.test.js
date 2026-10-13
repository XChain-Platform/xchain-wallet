// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
    'packages/core/src/shared/routes/Receive.module.css',
    'utf8',
);

function rule(cssText, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return cssText.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] || '';
}

describe('Receive form spacing', () => {
    it('separates the label editor from the following field group', () => {
        expect(rule(css, '.labelEditor'))
            .toMatch(/margin-bottom:\s*var\(--xc-space-3\)/);
    });
});
