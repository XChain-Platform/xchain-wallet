// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = join(process.cwd(), 'packages', 'core', 'src');
const guide = readFileSync(join(process.cwd(), 'STYLE_GUIDE.md'), 'utf8');
const documented = ['360px', '400px', '420px', '480px', '48rem', '520px', '600px', '640px', '1024px'];

function filesBelow(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        return entry.isDirectory() ? filesBelow(path) : [path];
    });
}

const modules = filesBelow(root).filter((path) => path.endsWith('.module.css'));

function widthValues(source) {
    return [...source.matchAll(/@media\s+([^\{]+)/g)].flatMap((media) => {
        const query = media[1];
        return [
            ...query.matchAll(/(?:min-|max-)?width\s*:\s*([\d.]+(?:px|rem|em))\b/g),
            ...query.matchAll(/\bwidth\s*[<>=]+\s*([\d.]+(?:px|rem|em))\b/g),
            ...query.matchAll(/\b([\d.]+(?:px|rem|em))\s*[<>=]+\s*width\b/g),
        ].map((match) => match[1]);
    });
}

describe('core CSS module media breakpoints', () => {
    it('uses only the documented viewport width scale', () => {
        const widths = new Set(modules.flatMap((path) => widthValues(readFileSync(path, 'utf8'))));
        expect([...widths].sort()).toEqual([
            '360px',
            '400px',
            '420px',
            '480px',
            '48rem',
            '520px',
            '600px',
            '640px',
        ]);
        for (const width of documented) expect(guide).toContain(`| \`${width}\` |`);
    });

    it('names lower-side boundaries without one-pixel aliases', () => {
        const sources = new Map(modules.map((path) => [
            relative(root, path),
            readFileSync(path, 'utf8'),
        ]));
        const combined = [...sources.values()].join('\n');

        expect(combined).not.toMatch(/\b(?:359|399|599|601|639|1023)px\b/);
        expect(sources.get('shared/commandPalette/CommandPalette.module.css'))
            .toContain('@media not all and (min-width: 640px)');
        expect(sources.get('shared/routes/IssueTokenForm.module.css'))
            .toContain('@media not all and (min-width: 400px)');
        expect(sources.get('shared/routes/Locked.module.css'))
            .toContain('@media not all and (min-width: 600px)');
        expect(sources.get('shared/routes/ManageToken.module.css').match(
            /@media not all and \(min-width: 600px\)/g,
        )).toHaveLength(2);
    });

    it('keeps 600px on the wide side of the form rule', () => {
        const formPage = readFileSync(join(root, 'ui', 'FormPage.module.css'), 'utf8');
        const locked = readFileSync(join(root, 'shared', 'routes', 'Locked.module.css'), 'utf8');

        expect(formPage).toContain('@media (min-width: 600px)');
        expect(locked).toContain('@media (min-width: 600px)');
        expect(locked).toContain('@media not all and (min-width: 600px)');
    });
});
