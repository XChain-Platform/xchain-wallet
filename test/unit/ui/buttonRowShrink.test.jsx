// Copyright © 2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Buttons in a row that runs out of room share the squeeze instead of
// pushing the last one past the container's edge. flex-shrink: 0 made any
// row of two full-width buttons overflow at narrow widths (the extension
// approval footer was the first one found). A shrinking button stops at its
// longest word, so labels wrap between words, and it keeps its 1px border,
// its control height and its coarse-pointer touch area.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '../../../packages/core/src/ui/Button.jsx';
import styles from '../../../packages/core/src/ui/Button.module.css';

const css = readFileSync('packages/core/src/ui/Button.module.css', 'utf8');
const rule = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))?.[1] || '';
};

describe('buttons in a full row', () => {
    it('shrink, but never below their longest word', () => {
        const btn = rule('.btn');
        expect(btn).toMatch(/flex-shrink:\s*1;/);
        expect(btn).not.toMatch(/flex-shrink:\s*0/);
        // min-width auto is the flex item's min-content: the longest word,
        // because break-word (unlike anywhere) does not lower min-content.
        expect(btn).toMatch(/min-width:\s*auto;/);
        expect(btn).toMatch(/overflow-wrap:\s*break-word;/);
        expect(btn).not.toMatch(/overflow-wrap:\s*anywhere/);
        expect(btn).toMatch(/white-space:\s*normal;/);
        // The floor is capped at the column, so a single word wider than the
        // whole column still breaks inside the button.
        expect(btn).toMatch(/max-width:\s*100%;/);
    });

    it('keep the 1px border, the control height and the touch area', () => {
        const btn = rule('.btn');
        expect(btn).toMatch(/border:\s*1px solid transparent;/);
        expect(btn).toMatch(/min-height:\s*var\(--xc-button-height, 36px\);/);
        expect(rule('.md')).toMatch(/min-height:\s*var\(--xc-control-h-md, 36px\);/);
        expect(rule('.lg')).toMatch(/min-height:\s*var\(--xc-control-h-lg, 44px\);/);
        // Icon-only buttons are square and never narrower than they are tall.
        expect(rule('.iconOnly')).toMatch(/min-width:\s*var\(--xc-button-height\);/);
        // Coarse pointers keep the enlarged hit area on small buttons.
        expect(css).toMatch(
            /@media \(pointer: coarse\), \(hover: none\) \{\s*\.sm::before \{[^}]*width:\s*max\(100%, var\(--xc-control-hit-min, 24px\)\);[^}]*height:\s*max\(100%, var\(--xc-control-hit-min, 24px\)\);/,
        );
    });

    it('lay a plain-text label out as one block of text', () => {
        expect(rule('.textLabel')).toMatch(/display:\s*block;/);
        // Labels holding elements keep the centred flex row.
        expect(rule('.label')).toMatch(/display:\s*inline-flex;/);

        const { rerender } = render(<Button icon={null}>Approve</Button>);
        let label = screen.getByRole('button', { name: 'Approve' }).querySelector(`.${styles.label}`);
        expect(label).toHaveClass(styles.textLabel);

        rerender(<Button icon={null}>{3} selected</Button>);
        label = screen.getByRole('button', { name: '3 selected' }).querySelector(`.${styles.label}`);
        expect(label).toHaveClass(styles.textLabel);

        rerender(<Button icon={null}><span>Explorer</span> ↗</Button>);
        label = screen.getByRole('button', { name: 'Explorer ↗' }).querySelector(`.${styles.label}`);
        expect(label).not.toHaveClass(styles.textLabel);
    });
});
