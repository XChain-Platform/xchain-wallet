// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FormSection } from '../../../packages/core/src/shared/components/formStandard/FormSection.jsx';
import { IconSelect } from '../../../packages/core/src/ui/IconSelect.jsx';

// A dropdown inside a collapsible form section opens over the page: no
// section box between the IconSelect and the page clips it (Address
// preferences' fee list showed only part of its options).
const sectionCss = readFileSync('packages/core/src/shared/routes/IssueTokenForm.module.css', 'utf8');
const standardCss = readFileSync('packages/core/src/shared/components/formStandard/formStandard.module.css', 'utf8');
const iconSelectCss = readFileSync('packages/core/src/ui/IconSelect.module.css', 'utf8');

/** Every declaration block whose selector list names `selector` exactly. */
function blocksFor(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?:^|\\n|,)\\s*${escaped}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, 'g');
    return [...css.matchAll(pattern)].map((match) => match[1]);
}

afterEach(cleanup);

describe('form section dropdowns', () => {
    it('lets the section card overflow so a dropdown inside is not clipped', () => {
        const section = blocksFor(sectionCss, '.optionalSection');
        expect(section.length).toBeGreaterThan(0);
        expect(section.join('\n')).toMatch(/overflow:\s*visible/);
        for (const block of section) expect(block).not.toMatch(/overflow(?:-[xy])?:\s*(?:hidden|clip|auto|scroll)/);
        for (const block of blocksFor(sectionCss, '.sectionBody')) {
            expect(block).not.toMatch(/overflow(?:-[xy])?:\s*(?:hidden|clip|auto|scroll)/);
        }
        for (const block of blocksFor(standardCss, '.sections')) {
            expect(block).not.toMatch(/overflow(?:-[xy])?:\s*(?:hidden|clip|auto|scroll)/);
        }
        // The header keeps the card's rounded corners itself.
        expect(blocksFor(sectionCss, '.sectionHeader').join('\n')).toMatch(/border-radius:\s*inherit/);
    });

    it('draws the IconSelect list as a popover that can extend past its container', () => {
        const popover = blocksFor(iconSelectCss, '.popover').join('\n');
        expect(popover).toMatch(/position:\s*absolute/);
        expect(popover).toMatch(/z-index:/);
    });

    it('shows every option of an IconSelect opened inside an open section', () => {
        const options = [
            { value: 'slow', label: 'Slow' },
            { value: 'normal', label: 'Normal' },
            { value: 'fast', label: 'Fast' },
            { value: 'custom', label: 'Custom' },
        ];
        render(
            <FormSection id="fees" title="Fees" defaultOpen>
                <IconSelect label="Fee" value="normal" onChange={vi.fn()} options={options} />
            </FormSection>,
        );

        fireEvent.click(screen.getByRole('button', { name: /Fee/, expanded: false }));
        const list = screen.getByRole('listbox');
        expect(list.closest('[data-form-section="fees"]')).not.toBeNull();
        expect(within(list).getAllByRole('option').map((option) => option.textContent.trim()))
            .toEqual(['Slow', 'Normal', 'Fast', 'Custom']);
    });
});
