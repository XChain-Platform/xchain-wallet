// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { cachedSourceFiles } from '../../helpers/sourceScan.js';

const root = join(process.cwd(), 'packages', 'core', 'src');
const guide = readFileSync(join(process.cwd(), 'STYLE_GUIDE.md'), 'utf8');
const documented = ['360px', '400px', '420px', '480px', '48rem', '600px', '640px', '1024px'];
const MEDIA_QUERY_PATTERN = /@media\s+([^\{]+)/g;
const WIDTH_PATTERNS = [
    /(?:min-|max-)?width\s*:\s*([\d.]+(?:px|rem|em))\b/g,
    /\bwidth\s*[<>=]+\s*([\d.]+(?:px|rem|em))\b/g,
    /\b([\d.]+(?:px|rem|em))\s*[<>=]+\s*width\b/g,
];
const modules = new Map(cachedSourceFiles(root, '**/*.module.css').map((file) => [
    file.relativePath,
    file.source,
]));

function widthValues(source) {
    return [...source.matchAll(MEDIA_QUERY_PATTERN)].flatMap((media) => {
        const query = media[1];
        return WIDTH_PATTERNS.flatMap((pattern) => (
            [...query.matchAll(pattern)].map((match) => match[1])
        ));
    });
}

describe('core CSS module media breakpoints', () => {
    it('uses only the documented viewport width scale', () => {
        const widths = new Set([...modules.values()].flatMap(widthValues));
        expect([...widths].sort()).toEqual([
            '360px',
            '400px',
            '420px',
            '480px',
            '48rem',
            '600px',
            '640px',
        ]);
        for (const width of documented) expect(guide).toContain(`| \`${width}\` |`);
    });

    it('names lower-side boundaries without one-pixel aliases', () => {
        const combined = [...modules.values()].join('\n');

        expect(combined).not.toMatch(/\b(?:359|399|599|601|639|1023)px\b/);
        expect(modules.get('shared/commandPalette/CommandPalette.module.css'))
            .toContain('@media not all and (min-width: 640px)');
        expect(modules.get('shared/routes/IssueTokenForm.module.css'))
            .toContain('@media not all and (min-width: 400px)');
        expect(modules.get('shared/routes/ManageToken.module.css').match(
            /@media not all and \(min-width: 600px\)/g,
        )).toHaveLength(2);
    });

    it('keeps 600px on the wide side of the form rule', () => {
        const formPage = modules.get('ui/FormPage.module.css');
        const locked = modules.get('shared/routes/Locked.module.css');

        expect(formPage).toContain('@media (min-width: 600px)');
        expect(locked).toContain('@media (min-width: 600px)');
        // The short-viewport rule keys on landscape height, not on width.
        expect(locked).toContain('@media (orientation: landscape) and (max-height: 480px)');
    });
});
