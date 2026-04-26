// Regression suite — UI button defaults.
//
//   [P1] 2026-04-25 — Secondary buttons rendered with dark text on a
//        light surface, making them look non-functional. Fix: every
//        variant now uses #FFFFFF text on a coloured fill; ghost
//        gained a slate fill so its white text is legible.
//
//   [P1] 2026-04-25 — Buttons could wrap to two lines under tight
//        widths (e.g., the popup viewport). Fix: `white-space: nowrap`
//        on the base .btn class.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = join(here, '..', '..', 'packages', 'core', 'src', 'ui', 'Button.module.css');
const css = readFileSync(cssPath, 'utf8');

describe('regression/ui-button-defaults', () => {
    it('[REGRESSION P1] every variant declares color #FFFFFF (no dark text bleeding through)', () => {
        for (const variant of ['primary', 'secondary', 'ghost', 'danger']) {
            const re = new RegExp(`\\.${variant}\\s*\\{[^}]*color:\\s*#FFFFFF`, 'i');
            expect(css).toMatch(re);
        }
    });

    it('[REGRESSION P1] base .btn declares white-space: nowrap', () => {
        expect(css).toMatch(/\.btn[\s\S]*?white-space:\s*nowrap/);
    });
});
