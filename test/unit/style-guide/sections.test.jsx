// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { SECTIONS } from '../../../packages/web/src/style-guide/StyleGuidePage.jsx';
import { VIEWS, ViewContext } from '../../../packages/web/src/style-guide/frames.jsx';

const root = resolve(import.meta.dirname, '../../..');
const styleGuideRoot = join(root, 'packages/web/src/style-guide');
const THEMES = ['light', 'dark'];

vi.mock('../../../packages/web/src/style-guide/frames.jsx', async (importOriginal) => {
    const frames = await importOriginal();
    return {
        ...frames,
        ViewFrame: ({ children }) => children,
        WidthTriptych: ({ render: renderExample }) => Object.values(frames.VIEWS).map((exampleView) => (
            <div key={exampleView.id}>{renderExample(exampleView)}</div>
        )),
    };
});

afterEach(() => {
    document.documentElement.removeAttribute('data-xc-theme');
});

describe.each(THEMES)('%s theme', (theme) => {
    describe.each(Object.values(VIEWS))('$label style-guide sections', ({ id: view }) => {
        it('renders every section with a heading', () => {
            document.documentElement.setAttribute('data-xc-theme', theme);

            const { container } = render(
                <ViewContext.Provider value={view}>
                    {SECTIONS.map(({ id, Component }) => <Component key={id} />)}
                </ViewContext.Provider>,
            );

            for (const { id } of SECTIONS) {
                const section = container.querySelector(`#${id}`);
                expect(section, id).not.toBeNull();
                expect(section.querySelector(':scope > h2'), id).toHaveTextContent(/\S/);

                const guidanceTerms = [...section.querySelectorAll(':scope > .sg-guide dt')]
                    .map((term) => term.textContent);
                expect(guidanceTerms, id).toEqual(expect.arrayContaining([
                    'When',
                    'When not',
                    'Do',
                    "Don't",
                ]));
            }
        });
    });
});

describe('style-guide theme colors', () => {
    it('resolves every CSS token and keeps theme surfaces free of raw colors', () => {
        const sectionRoot = join(styleGuideRoot, 'sections');
        const cssPaths = [
            join(styleGuideRoot, 'style-guide.css'),
            ...readdirSync(sectionRoot)
                .filter((file) => file.endsWith('.css'))
                .map((file) => join(sectionRoot, file)),
        ];
        const tokens = readFileSync(join(root, 'packages/core/src/ui/tokens.css'), 'utf8');
        const declaredTokens = new Set(
            [...tokens.matchAll(/(--xc-[\w-]+)\s*:/g)].map((match) => match[1]),
        );

        for (const path of cssPaths) {
            const css = readFileSync(path, 'utf8');
            for (const [, token] of css.matchAll(/var\((--xc-[\w-]+)/g)) {
                expect(declaredTokens.has(token), `${path}: ${token}`).toBe(true);
            }
        }

        for (const path of [
            join(styleGuideRoot, 'style-guide.css'),
            join(sectionRoot, 'AccentBorderedCardSection.module.css'),
        ]) {
            const css = readFileSync(path, 'utf8');
            expect(css, path).not.toMatch(/#[\da-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
        }
    });
});
