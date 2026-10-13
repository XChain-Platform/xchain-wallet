// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const rendererDir = resolve(process.cwd(), 'packages/desktop/renderer');
const rendererComponents = readdirSync(rendererDir, { recursive: true })
    .filter((file) => file.endsWith('.jsx') && file !== 'DesktopUpdateBanner.jsx');

describe('desktop renderer style guide controls', () => {
    it('keeps hand-rolled form and action controls out of renderer components', () => {
        expect(rendererComponents).not.toHaveLength(0);

        for (const file of rendererComponents) {
            const source = readFileSync(resolve(rendererDir, file), 'utf8');

            expect(source, file).not.toMatch(/<(?:button|input|select|textarea)\b/);
        }
    });
});
