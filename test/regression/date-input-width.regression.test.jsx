// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: shared date input width.
//
//   [P1] 2026-10-13: Native calendar controls carry an intrinsic minimum
//        width that can push History and other shared forms past a 360px
//        viewport. The shared field and input rules keep the control inside
//        its container, including its padding and border.

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Input } from '../../packages/core/src/ui/Input.jsx';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const inputCss = readFileSync(join(root, 'packages/core/src/ui/Input.module.css'), 'utf8');
const historySource = readFileSync(
    join(root, 'packages/core/src/shared/routes/History.jsx'),
    'utf8',
);

function ruleBody(pattern) {
    return pattern.exec(inputCss)?.[1] ?? '';
}

afterEach(() => {
    cleanup();
    document.documentElement.style.width = '';
});

describe('regression/date-input-width', () => {
    it('[REGRESSION P1] keeps History date filters on the width-safe shared Input', () => {
        const dateRow = /<div className=\{styles\.dateRow\}>([\s\S]*?)<div className=\{styles\.dateTools\}>/
            .exec(historySource)?.[1] ?? '';
        const controls = dateRow.match(/<Input\b[\s\S]*?\/>/g) ?? [];

        expect(controls).toHaveLength(2);
        for (const control of controls) expect(control).toMatch(/type="date"/);
        expect(dateRow).not.toMatch(/<input\b/);
    });

    it('[REGRESSION P1] fits every shared date and time input inside a 360px viewport', () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 });
        document.documentElement.style.width = '360px';
        render(
            <div data-testid="viewport" style={{ width: '360px', maxWidth: '100vw' }}>
                <Input aria-label="Date" type="date" />
                <Input aria-label="Date and time" type="datetime-local" />
                <Input aria-label="Time" type="time" />
            </div>,
        );

        const fieldRule = ruleBody(/^\.field\s*\{([^}]*)\}/m);
        const inputRule = ruleBody(/^\.input\s*\{([^}]*)\}/m);
        const calendarRule = ruleBody(
            /\.input:is\(\[type='date'\], \[type='datetime-local'\], \[type='time'\]\)\s*\{([^}]*)\}/,
        );
        const hitAreaRule = ruleBody(/^\.controlHitArea\s*\{([^}]*)\}/m);

        expect(fieldRule).toMatch(/min-width:\s*0/);
        expect(hitAreaRule).toMatch(/width:\s*100%/);
        expect(inputRule).toMatch(/width:\s*100%/);
        expect(inputRule).toMatch(/min-width:\s*0/);
        expect(inputRule).toMatch(/max-width:\s*100%/);
        expect(calendarRule).toMatch(/box-sizing:\s*border-box/);
        expect(calendarRule).toMatch(/width:\s*100%/);
        expect(calendarRule).toMatch(/min-width:\s*0/);

        expect(screen.getByTestId('viewport')).toHaveStyle({ width: '360px', maxWidth: '100vw' });
        const controls = ['Date', 'Date and time', 'Time'].map((name) => screen.getByLabelText(name));
        expect(controls.map((input) => input.type)).toEqual(['date', 'datetime-local', 'time']);
        expect(new Set(controls.map((input) => input.className)).size).toBe(1);
        expect(new Set(controls.map((input) => input.parentElement.parentElement.className)).size)
            .toBe(1);
    });
});
