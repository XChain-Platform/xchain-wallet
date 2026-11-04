// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// @vitest-environment node

// A CSS-file composes from Button.module.css inlines a second copy of that
// sheet into the composing module's CSS. When that module sits in a lazy
// route chunk (Receive did), the copy loads after every sheet the main chunk
// already applied, so Button's one-class rules re-apply over one-class rules
// in earlier sheets and rows and controls on later screens take the Button
// look. A module that wants the shared button base applies Button's classes
// in markup instead (TokenField, ChainPicker, Chip and Receive do).

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const coreSrc = resolve('packages/core/src');
const BUTTON_COMPOSES = /composes:[^;]*from\s*['"][^'"]*\/Button\.module\.css['"]/;

// Every core CSS module, with comments stripped so prose that names the
// Button sheet does not count.
function coreModuleSheets() {
    return readdirSync(coreSrc, { recursive: true })
        .filter((rel) => rel.endsWith('.module.css'))
        .map((rel) => ({
            rel,
            source: readFileSync(join(coreSrc, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''),
        }));
}

describe('core CSS modules and the Button sheet', () => {
    it('finds the core CSS modules', () => {
        const sheets = coreModuleSheets().map(({ rel }) => rel);
        expect(sheets.length).toBeGreaterThan(50);
        expect(sheets).toContain(join('ui', 'Button.module.css'));
        expect(sheets).toContain(join('shared', 'routes', 'Receive.module.css'));
    });

    it('never composes from Button.module.css', () => {
        const composing = coreModuleSheets()
            .filter(({ source }) => BUTTON_COMPOSES.test(source))
            .map(({ rel }) => rel);
        expect(composing, 'core modules that compose from Button.module.css').toEqual([]);
    });
});
