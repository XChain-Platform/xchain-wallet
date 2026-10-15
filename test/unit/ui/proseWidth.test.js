// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readCss = (path) => readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function rule(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&');
    return new RegExp(`(?:^|})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css)?.[1] ?? '';
}

describe('readable prose width', () => {
    const tokens = readCss('packages/core/src/ui/tokens.css');
    const proseWidth = /max-width:\s*var\(--xc-prose-max-width\)/;

    it('defines one 70ch measure and applies it to semantic paragraphs', () => {
        expect(tokens).toMatch(/--xc-prose-max-width:\s*70ch/);
        expect(rule(tokens, ':where(p)')).toMatch(proseWidth);
    });

    it.each([
        ['packages/core/src/ui/ListPage.module.css', '.intro'],
        ['packages/core/src/ui/SectionHeader.module.css', '.description'],
        ['packages/core/src/ui/EmptyState.module.css', '.body'],
        ['packages/core/src/ui/Input.module.css', '.hint'],
        ['packages/core/src/ui/Input.module.css', '.error'],
        ['packages/core/src/ui/Input.module.css', '.capsLock'],
        ['packages/core/src/ui/StatusMessage.module.css', '.text'],
        ['packages/core/src/shared/components/LearnNote.module.css', '.body'],
    ])('caps the %s %s text block', (path, selector) => {
        expect(rule(readCss(path), selector)).toMatch(proseWidth);
    });

    it.each([
        ['packages/core/src/ui/ListPage.module.css', '.page'],
        ['packages/core/src/ui/EmptyState.module.css', '.wrap'],
        ['packages/core/src/ui/StatusMessage.module.css', '.row'],
        ['packages/core/src/shared/components/LearnNote.module.css', '.note'],
        ['packages/core/src/ui/FormPage.module.css', '.form'],
    ])('keeps the %s %s container free of the prose cap', (path, selector) => {
        expect(rule(readCss(path), selector)).not.toMatch(/--xc-prose-max-width/);
    });

    it('does not apply the prose measure to list, table, or form elements', () => {
        expect(tokens).not.toMatch(/:where\([^)]*\b(?:ul|ol|table|form)\b[^)]*\)\s*\{[^}]*--xc-prose-max-width/s);
    });
});
