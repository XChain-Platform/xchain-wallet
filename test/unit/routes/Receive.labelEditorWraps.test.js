// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// At 1.5 text on a 320 px screen the Receive label field shrank to about five
// characters beside its Save button. The row wraps, and the field keeps a
// readable basis, so the button drops to its own line instead.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../../packages/core/src/shared/routes/Receive.module.css'),
    'utf8',
);

function rule(selector) {
    const start = css.indexOf(`${selector} {`);
    expect(start).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf('}', start));
}

// The approved redesign retired the Receive label editor (labels are not edited on Receive),
// so the wrap rule it needed is gone with it.
describe('Receive label editor layout', () => {
    it('no longer carries a label editor row or its stylesheet rule', () => {
        expect(css).not.toContain('.labelEditor');
        const jsx = readFileSync(
            join(dirname(fileURLToPath(import.meta.url)), '../../../packages/core/src/shared/routes/Receive.jsx'),
            'utf8',
        );
        expect(jsx).not.toContain('labelEditor');
    });
});
