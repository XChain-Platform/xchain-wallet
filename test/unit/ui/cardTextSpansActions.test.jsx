// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Input } from '../../../packages/core/src/ui/Input.jsx';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');
const readCss = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, '');

function cssRule(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&');
    return new RegExp(`(?:^|})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css)?.[1] ?? '';
}

function jsObject(source, name) {
    return new RegExp(`const ${name} = \\{([^}]*)\\};`).exec(source)?.[1] ?? '';
}

describe('card body text spans the width of the actions below it', () => {
    it('lets the pair screen paragraphs fill the card', () => {
        const copy = jsObject(read('packages/core/src/shared/routes/PairPartnerWallet.jsx'), 'COPY');
        expect(copy).toMatch(/maxWidth:\s*'none'/);
    });

    it('lets the import drop hint fill the form card', () => {
        const rule = cssRule(read('packages/core/src/shared/routes/ImportWallet.module.css'), '.dropHint');
        expect(rule).toMatch(/max-width:\s*none/);
    });

    it('lets the field hint fill the form card', () => {
        const rule = cssRule(readCss('packages/core/src/ui/Input.module.css'), '.hint');
        expect(rule).not.toBe('');
        expect(rule).not.toMatch(/max-width/);
    });

    it('keeps the prose cap on field errors and the caps lock warning', () => {
        const css = readCss('packages/core/src/ui/Input.module.css');
        expect(cssRule(css, '.error')).toMatch(/max-width:\s*var\(--xc-prose-max-width\)/);
        expect(cssRule(css, '.capsLock')).toMatch(/max-width:\s*var\(--xc-prose-max-width\)/);
    });

    it('renders a field hint inside a form card with the module hint class and no inline width cap', () => {
        const { container } = render(
            <form className="formCard">
                <Input
                    label="Recovery phrase file"
                    value=""
                    onChange={() => {}}
                    hint="Drop a backup file here or type the phrase below."
                />
            </form>,
        );
        const hint = Array.from(container.querySelectorAll('div[id$="-hint"]')).find(
            (node) => node.textContent === 'Drop a backup file here or type the phrase below.',
        );
        expect(hint).toBeTruthy();
        expect(hint.className).toMatch(/hint/);
        expect(hint.style.maxWidth).toBe('');
        expect(hint.getAttribute('style') ?? '').not.toMatch(/max-width/);
    });
});
