// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    DOCUMENTED_PRIMITIVES,
    SECTIONS,
} from '../../../packages/web/src/style-guide/StyleGuidePage.jsx';

const root = path.resolve(import.meta.dirname, '../../..');
const uiIndexPath = path.join(root, 'packages/core/src/ui/index.js');

function namedComponentExports(source) {
    const named = [...source.matchAll(
        /export\s+\{\s*([A-Z][A-Za-z0-9]*)\s*\}\s+from/g,
    )].map((match) => match[1]);
    const namespaces = [...source.matchAll(
        /export\s+\*\s+as\s+([A-Z][A-Za-z0-9]*)\s+from/g,
    )].map((match) => match[1]);
    return [...named, ...namespaces].sort();
}

describe('style guide primitive coverage', () => {
    it('tracks every component exported by the core UI barrel', () => {
        const uiIndex = fs.readFileSync(uiIndexPath, 'utf8');

        expect([...DOCUMENTED_PRIMITIVES].sort()).toEqual(namedComponentExports(uiIndex));
        expect(new Set(SECTIONS.map(({ id }) => id)).size).toBe(SECTIONS.length);
    });

    it('gives every newly audited primitive guidance, JSX, and a live example', () => {
        const files = [
            'ChoicePrimitivesSection.jsx',
            'DisplayPrimitivesSection.jsx',
            'QrPrimitivesSection.jsx',
        ].map((file) => fs.readFileSync(
            path.join(root, 'packages/web/src/style-guide/sections', file),
            'utf8',
        )).join('\n');
        const primitives = [
            'IconSelect',
            'AddressCombobox',
            'ChainBadge',
            'AddressText',
            'CopyButton',
            'MultisigBadge',
            'VerifiedBadge',
            'InfoTip',
            'AnimatedQrFrames',
            'QrScanner',
        ];

        for (const primitive of primitives) {
            const start = files.indexOf(`export function ${primitive}Section()`);
            const next = files.indexOf('\nexport function ', start + 1);
            const section = files.slice(start, next === -1 ? files.length : next);
            expect(start, `${primitive} has a section`).toBeGreaterThanOrEqual(0);
            expect(section, `${primitive} has guidance`).toContain('<Guidance');
            expect(section, `${primitive} has canonical JSX`).toContain('<Markup>');
            expect(section, `${primitive} has a live example`).toContain('<LiveExample');
        }
    });
});
