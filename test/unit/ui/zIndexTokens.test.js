// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8');

describe('shared z-index tokens', () => {
    it('defines the six layers in ascending order', () => {
        const tokens = read('packages/core/src/ui/tokens.css');
        const names = ['base', 'sticky', 'dropdown', 'overlay', 'modal', 'toast'];
        const values = names.map((name) => Number(
            new RegExp(`--xc-z-${name}:\\s*(\\d+);`).exec(tokens)?.[1],
        ));

        expect(values).toEqual([1, 20, 50, 60, 1000, 9999]);
        expect(values).toEqual([...values].sort((left, right) => left - right));
    });

    it('uses semantic layers for shared stacking surfaces', () => {
        const cases = [
            ['shared/components/BottomTabBar.module.css', ['sticky', 'overlay', 'modal']],
            ['shared/components/HeaderSettingsButton.module.css', ['dropdown']],
            ['shared/commandPalette/CommandPalette.module.css', ['overlay']],
            ['shared/components/NoticeModal.module.css', ['modal']],
            ['shared/components/ToastHost.module.css', ['toast']],
        ];

        for (const [file, layers] of cases) {
            const css = read('packages/core/src', file);
            for (const layer of layers) {
                expect(css).toContain(`z-index: var(--xc-z-${layer})`);
            }
            expect(css).not.toMatch(/z-index:\s*-?\d/);
        }
    });
});
