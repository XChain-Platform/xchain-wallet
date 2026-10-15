// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const componentNames = [
    'LearnNote',
    'LockedTokenContext',
    'MarketLifecycleTimeline',
    'MarketTrading',
    'MnemonicGrid',
    'NetworkFilterDropdown',
];

const readComponentCss = (name) => readFileSync(join(
    process.cwd(),
    'packages/core/src/shared/components',
    `${name}.module.css`,
), 'utf8');

describe('shared component design-token geometry', () => {
    it('limits raw pixels to breakpoints, hairlines, and documented exceptions', () => {
        for (const name of componentNames) {
            const css = readComponentCss(name);
            const rawPixelDeclarations = css.split('\n')
                .map((line) => line.trim())
                .filter((line) => !line.startsWith('@media'))
                .filter((line) => /:\s*[^;]*\d+(?:\.\d+)?px\b/.test(line));

            for (const declaration of rawPixelDeclarations) {
                const hairline = /^(?:border(?:-[a-z-]+)?|outline):\s*(?:1|2)px\b/.test(declaration);
                const documentedException = (
                    name === 'LearnNote'
                    && [
                        'border-inline-start: 3px solid var(--xc-accent-primary);',
                        'text-underline-offset: 2px;',
                        'outline-offset: 2px;',
                    ].includes(declaration)
                ) || (name === 'LockedTokenContext' && declaration === 'gap: 2px;');
                expect(hairline || documentedException, `${name}: ${declaration}`).toBe(true);
            }
        }

        const learnNote = readComponentCss('LearnNote');
        expect(learnNote).toMatch(
            /\/\* The accent rail has no matching border-width token\. \*\/\s*border-inline-start:\s*3px/,
        );
        expect(learnNote).toMatch(
            /\/\* Two pixels separate the underline without changing the line box\. \*\/\s*text-underline-offset:\s*2px/,
        );
        expect(learnNote).toMatch(
            /\/\* Two pixels separate the focus ring without enlarging the control\. \*\/\s*outline-offset:\s*2px/,
        );
        expect(readComponentCss('LockedTokenContext')).toMatch(
            /\/\* Two pixels keep the two text lines visually grouped\. \*\/\s*gap:\s*2px/,
        );
    });

    it('maps every dropdown size to its matching control-height token', () => {
        const dropdown = readComponentCss('NetworkFilterDropdown');

        for (const size of ['sm', 'md', 'lg']) {
            expect(dropdown).toMatch(new RegExp(
                `\\.${size}\\s*\\{[^}]*--network-filter-control-height:\\s*var\\(--xc-control-h-${size}\\)`,
                's',
            ));
        }
    });
});
