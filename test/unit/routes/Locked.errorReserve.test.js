// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The idle lock screen reserves one field-error line below its actions so the
// centred form keeps one height and the password field does not move when
// "Incorrect password." shows. The reserve must be the error line's own size:
// when the Input error moved from the xs to the sm text, the reserve kept xs
// and the field moved 1.4px. jsdom has no layout, so this pins the CSS pair.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(join(process.cwd(), path), 'utf8');

function ruleBody(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&');
    return new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? null;
}

const declaration = (body, property) => new RegExp(`(?:^|;|\\s)${property}:\\s*([^;]+);`).exec(body)?.[1].trim();

describe('locked screen error reserve', () => {
    it('reserves the Input error line at its own gap, size and line height', () => {
        const error = ruleBody(read('packages/core/src/ui/Input.module.css'), '.error');
        const reserve = ruleBody(read('packages/core/src/shared/routes/Locked.module.css'), '.centreIdle::after');
        expect(error).not.toBeNull();
        expect(reserve).not.toBeNull();

        const gap = declaration(error, 'margin-block-start');
        const size = declaration(error, 'font-size');
        const lineHeight = declaration(error, 'line-height');
        expect(declaration(reserve, 'block-size')).toBe(`calc(${gap} + ${size} * ${lineHeight})`);
    });
});
