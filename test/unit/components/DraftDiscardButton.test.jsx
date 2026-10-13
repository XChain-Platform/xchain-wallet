// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The saved-draft banner's Discard link rendered 12px tall in the browser
// (the responsive e2e walk measured it at 37x12 on Send at 360px): each form
// carried an inline-styled copy with `padding: 0` and an extra-small font,
// and inline styles never reach the stylesheet tap-target sweep. These
// guards pin the shared button, its stated 24px floor, and that no form
// goes back to an inline copy.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { DraftDiscardButton } from '../../../packages/core/src/shared/components/DraftDiscardButton.jsx';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const DRAFT_FORMS = [
    'packages/core/src/shared/routes/Send.jsx',
    'packages/core/src/shared/routes/DispenserForm.jsx',
    'packages/core/src/shared/routes/IssueTokenForm.jsx',
    'packages/core/src/shared/routes/SignMessageForm.jsx',
];

describe('DraftDiscardButton', () => {
    it('is a plain button named by its label that discards on click', () => {
        const onClick = vi.fn();
        render(<DraftDiscardButton onClick={onClick} label="Discard saved draft">Discard</DraftDiscardButton>);
        const button = screen.getByRole('button', { name: 'Discard saved draft' });
        expect(button.getAttribute('type')).toBe('button');
        expect(button.textContent).toBe('Discard');
        expect(button.getAttribute('style')).toBeNull();
        fireEvent.click(button);
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('states the pointer-target floor on both axes in its stylesheet', () => {
        const css = read('packages/core/src/shared/components/DraftDiscardButton.module.css');
        const rule = css.match(/\.discard\s*\{([^}]*)\}/);
        expect(rule).not.toBeNull();
        expect(rule[1]).toMatch(/min-height:\s*var\(--xc-tap-min\)/);
        expect(rule[1]).toMatch(/min-width:\s*var\(--xc-tap-min\)/);
        expect(read('packages/core/src/ui/tokens.css')).toMatch(/--xc-tap-min:\s*24px;/);
    });

    it.each(DRAFT_FORMS)('%s renders its Discard through the shared button, never an inline-styled copy', (file) => {
        const src = read(file);
        expect(src).toMatch(/<DraftDiscardButton onClick=\{dismissDraft\} label=/);
        expect(src).not.toMatch(/onClick=\{dismissDraft\}[\s\S]{0,200}?style=\{\{/);
    });
});
