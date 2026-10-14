// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const res = join(root, 'packages', 'mobile', 'android', 'app', 'src', 'main', 'res');
const densities = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];

describe('Android app icon references', () => {
    it('provides the legacy launcher artwork at every density', () => {
        for (const density of densities) {
            for (const name of ['ic_launcher', 'ic_launcher_round', 'ic_launcher_foreground']) {
                expect(existsSync(join(res, `mipmap-${density}`, `${name}.png`))).toBe(true);
            }
        }
    });

    it('provides Android 13 monochrome layers backed by every foreground density', () => {
        for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
            const xml = readFileSync(join(res, 'mipmap-anydpi-v33', name), 'utf8');
            expect(xml).toMatch(/<background android:drawable="@color\/ic_launcher_background"\s*\/>/);
            expect(xml).toMatch(/<foreground android:drawable="@mipmap\/ic_launcher_foreground"\s*\/>/);
            expect(xml).toMatch(/<monochrome android:drawable="@mipmap\/ic_launcher_foreground"\s*\/>/);
        }

        for (const density of densities) {
            expect(existsSync(join(res, `mipmap-${density}`, 'ic_launcher_foreground.png'))).toBe(true);
        }
    });
});
