// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The recovery phrase box never changes size on Reveal: the concealed state
// renders the same grid and cell structure as the revealed words (with blurred
// placeholder words), so only the contents swap. The words stay out of the DOM while
// concealed. The two Create Wallet gaps around the phrase are the 8px token.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { MnemonicGrid } from '../../../packages/core/src/shared/components/MnemonicGrid.jsx';

afterEach(() => cleanup());

const PHRASE = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima';

/** The grid's class list and each cell's class list: the box's size-defining structure. */
function shape(container) {
    // Concealed, the grid sits in the labelled "Recovery phrase hidden" group.
    const grid = container.querySelector('[data-mnemonic-card] ol');
    const cells = [...grid.querySelectorAll('li')];
    const strip = (cls) => cls.split(/\s+/).filter((c) => !/concealed/i.test(c)).sort().join(' ');
    return {
        card: container.querySelector('[data-mnemonic-card]').className,
        grid: strip(grid.className),
        cells: cells.length,
        cellClasses: [...new Set(cells.map((li) => strip(li.className)))],
        childTags: [...new Set(cells.flatMap((li) => [...li.children].map((c) => `${c.tagName}.${strip(c.className)}`)))].sort(),
    };
}

describe.each(['full', 'small'])('MnemonicGrid box (%s)', (variant) => {
    it('keeps one card, grid class, cell count and cell structure in both states', () => {
        const { container } = render(<MnemonicGrid mnemonic={PHRASE} variant={variant} />);
        const concealed = shape(container);
        fireEvent.click(screen.getByRole('button', { name: /reveal recovery phrase/i }));
        const revealed = shape(container);
        expect(revealed.cells).toBe(12);
        expect(revealed).toEqual(concealed);
    });

    it('keeps every word out of the DOM while concealed', () => {
        const { container } = render(<MnemonicGrid mnemonic={PHRASE} variant={variant} />);
        for (const word of PHRASE.split(' ')) expect(container.textContent).not.toContain(word);
        expect(container.querySelector('[data-secret]')).toBeNull();
        expect(container.querySelector('[data-concealed-area]').getAttribute('aria-hidden')).toBe('true');
    });
});

describe('Create Wallet recovery phrase gaps', () => {
    const css = readFileSync(join(process.cwd(), 'packages/core/src/shared/routes/CreateWallet.module.css'), 'utf8');
    const gridCss = readFileSync(join(process.cwd(), 'packages/core/src/shared/components/MnemonicGrid.module.css'), 'utf8');

    // 2026-11-16: FormPage's status slot puts the next element 8px under the
    // notice for every form, so the stack no longer pulls itself up (the two
    // pulls together drew 0px).
    it('puts the notice and the phrase box 8px apart through the shared status slot, with no local pull', () => {
        expect(css).not.toMatch(/\.phraseStack\s*\{[^}]*margin-block-start/s);
        const formCss = readFileSync(join(process.cwd(), 'packages/core/src/ui/FormPage.module.css'), 'utf8');
        expect(formCss).toMatch(/\.status:not\(:empty\) \+ \*,[^{]*\{\s*margin-block-start:\s*calc\(var\(--xc-space-2\) - var\(--xc-form-gap, var\(--xc-space-4\)\)\);/);
    });

    it('puts the checkbox row and the button 8px apart (stack gap, row not taller than the tap floor)', () => {
        expect(css).toMatch(/\.phraseStack,\s*\.quizActions\s*\{[^}]*gap:\s*var\(--xc-space-2\);/s);
        expect(css).toMatch(/\.phraseStack \.confirmRow\s*\{[^}]*min-height:\s*var\(--xc-tap-min\);/s);
    });

    it('gives a concealed cell no size of its own, so it sizes like a revealed cell', () => {
        expect(gridCss).not.toMatch(/\.concealedCell\s*\{[^}]*min-height/s);
    });
});
