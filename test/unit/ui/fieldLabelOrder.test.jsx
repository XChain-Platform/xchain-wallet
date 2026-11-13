// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Input } from '../../../packages/core/src/ui/Input.jsx';
import { Select } from '../../../packages/core/src/ui/Select.jsx';
import { Textarea } from '../../../packages/core/src/ui/Textarea.jsx';

// Every field label row reads: the label, the ? help, the Optional tag,
// then the character count.
afterEach(cleanup);

/** The label row's parts in document order, as short names. */
function labelRowParts(labelText) {
    const label = screen.getByText(labelText, { selector: 'label' });
    const row = label.parentElement;
    return Array.from(row.children).map((child) => {
        if (child === label) return 'label';
        if (child.querySelector('button[aria-label^="About"]') || child.matches('button[aria-label^="About"]')) return 'help';
        if (/^\s*Optional\s*$/.test(child.textContent)) return 'optional';
        if (/^\d+ \/ \d+$/.test(child.textContent.trim())) return 'count';
        return `other:${child.textContent}`;
    });
}

describe('field label order', () => {
    it('puts the help, then Optional, then the count on an Input', () => {
        render(<Input label="Memo" help="What the memo is for." optional maxLength={20} defaultValue="abc" />);
        expect(labelRowParts('Memo')).toEqual(['label', 'help', 'optional', 'count']);
    });

    it('puts the help, then Optional, then the count on a Textarea', () => {
        render(<Textarea label="Notes" help="What the notes are for." optional maxLength={50} defaultValue="hi" />);
        expect(labelRowParts('Notes')).toEqual(['label', 'help', 'optional', 'count']);
    });

    it('puts the help, then Optional on a Select', () => {
        render(
            <Select label="Speed" help="How fast it confirms." optional defaultValue="a">
                <option value="a">A</option>
            </Select>,
        );
        expect(labelRowParts('Speed')).toEqual(['label', 'help', 'optional']);
    });

    it('never reorders the label row with CSS', () => {
        for (const path of ['packages/core/src/ui/Input.module.css', 'packages/core/src/ui/Textarea.module.css']) {
            const css = readFileSync(path, 'utf8');
            const rowRules = [...css.matchAll(/\.labelRow[^{]*\{([^}]*)\}/g)].map((match) => match[1]).join('\n');
            expect(rowRules).not.toMatch(/\border:/);
            expect(rowRules).not.toMatch(/flex-direction:\s*row-reverse/);
        }
    });
});
