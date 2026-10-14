// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Every form field is spaced by the one form gap token.
//
// The Network picker, token picker, icon dropdown, locked token context and
// fee selector each added their own margin on top of the form gap, so the
// space after them was larger than after an address field. A field root now
// carries no outer block margin and the form around it owns the spacing.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

/** Body of the first rule whose selector is exactly `selector`. */
function ruleBody(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? null;
}

describe('form field gaps', () => {
    const fieldRoots = [
        ['packages/core/src/ui/Input.module.css', '.field'],
        ['packages/core/src/ui/ChainPicker.module.css', '.wrap'],
        ['packages/core/src/ui/IconSelect.module.css', '.wrap'],
        ['packages/core/src/ui/FeeSelector.module.css', '.wrap'],
        ['packages/core/src/shared/components/TokenField.module.css', '.field'],
        ['packages/core/src/shared/components/LockedTokenContext.module.css', '.wrap'],
    ];

    it.each(fieldRoots)('%s %s adds no outer block margin', (file, selector) => {
        const body = ruleBody(read(file), selector);
        expect(body).not.toBeNull();
        const margins = [...body.matchAll(/(margin(?:-top|-bottom|-block(?:-start|-end)?)?)\s*:\s*([^;]+);/g)]
            .map(([, prop, value]) => `${prop}: ${value.trim()}`);
        for (const margin of margins) expect(margin).toMatch(/:\s*0(px)?$/);
    });

    it('spaces form fields with the one form gap token', () => {
        const formCss = read('packages/core/src/ui/FormPage.module.css');
        expect(ruleBody(formCss, '.form')).toMatch(/gap:\s*var\(--xc-form-gap\)/);
        expect(ruleBody(formCss, '.body')).toMatch(/gap:\s*var\(--xc-form-gap\)/);
    });

    it('keeps the label gap on the shared label token in every picker', () => {
        for (const file of [
            'packages/core/src/ui/ChainPicker.module.css',
            'packages/core/src/ui/IconSelect.module.css',
            'packages/core/src/shared/components/LockedTokenContext.module.css',
        ]) {
            expect(ruleBody(read(file), '.wrap')).toMatch(/gap:\s*var\(--xc-label-gap\)/);
        }
        expect(ruleBody(read('packages/core/src/ui/Input.module.css'), '.label')).toMatch(/margin-block-end:\s*var\(--xc-label-gap\)/);
    });

    it('wraps no field in a spacer that adds its own gap', () => {
        expect(read('packages/core/src/shared/routes/DispenserForm.jsx')).not.toMatch(/feeToggleGap/);
    });
});
