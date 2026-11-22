// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const components = join(process.cwd(), 'packages/core/src/shared/components');
const readCss = (name) => readFileSync(join(components, name), 'utf8');
const compact = (value) => value.replace(/\s+/g, ' ').trim();

function declarations(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 's'));
    expect(match, `missing CSS rule: ${selector}`).not.toBeNull();
    return Object.fromEntries(match[1]
        .split(';')
        .map((declaration) => declaration.trim())
        .filter(Boolean)
        .map((declaration) => {
            const colon = declaration.indexOf(':');
            return [declaration.slice(0, colon).trim(), compact(declaration.slice(colon + 1))];
        }));
}

describe('horizontal fold layout', () => {
    it('docks compact navigation wholly inside the lower display', () => {
        const css = readCss('BottomTabBar.module.css');
        const base = declarations(css, '.bar');
        const fold = declarations(css, ":global(html[data-fold='horizontal']) .bar");
        expect(base.position).toBe('absolute');
        expect(fold['inset-block-end']).toBe('0');
        expect(fold['min-block-size']).toBe('0');
        expect(fold['block-size']).toBe('min( 3.5rem, max(0px, calc( var(--xc-viewport-h, 100vh) - var(--xc-fold-y, calc(var(--xc-space-1) - var(--xc-space-1))) - var(--xc-fold-height, calc(var(--xc-space-1) - var(--xc-space-1))) - env(safe-area-inset-bottom, 0px) )) )');
        expect(fold.overflow).toBe('hidden');
    });

    it('centres dialogs in the lower display', () => {
        const css = readCss('OverlaySurface.module.css');
        const base = declarations(css, '.dialogOverlay');
        const overlay = declarations(css, ":global(html[data-fold='horizontal']) .dialogOverlay");
        const dialog = declarations(css, ":global(html[data-fold='horizontal']) .dialog");
        expect(base['align-items']).toBe('center');
        expect(overlay['padding-block-start']).toBe('calc( var(--xc-fold-y, calc(var(--xc-space-1) - var(--xc-space-1))) + var(--xc-fold-height, calc(var(--xc-space-1) - var(--xc-space-1))) + var(--xc-space-4) )');
        expect(overlay['padding-block-end']).toBe('var(--xc-space-4)');
        expect(dialog['max-height']).toBe('calc( var(--xc-viewport-h, 100vh) - var(--xc-fold-y, calc(var(--xc-space-1) - var(--xc-space-1))) - var(--xc-fold-height, calc(var(--xc-space-1) - var(--xc-space-1))) - var(--xc-space-8) )');
    });

    it('anchors Confirm facts and decisions on opposite sides of the division', () => {
        const css = readCss('ConfirmActionModal.module.css');
        const screenSelector = ":global(html[data-fold='horizontal'] div:has(> main > [data-testid='confirm-modal']):has(> footer [data-testid='confirm-decision']))";
        const bodySelector = ":global(html[data-fold='horizontal'] div:has(> main > [data-testid='confirm-modal']) > main)";
        const footerSelector = ":global(html[data-fold='horizontal'] div:has(> main > [data-testid='confirm-modal']) > footer:has([data-testid='confirm-decision']))";
        const screen = declarations(css, screenSelector);
        const body = declarations(css, bodySelector);
        const footer = declarations(css, footerSelector);
        expect(screen.position).toBe('fixed');
        expect(screen.inset).toBe('0');
        expect(screen['block-size']).toBe('var(--xc-viewport-h, 100vh)');
        expect(screen.display).toBe('grid');
        expect(screen['grid-template-rows']).toBe('auto minmax(0, 1fr) var(--xc-fold-height, calc(var(--xc-space-1) - var(--xc-space-1))) max(0px, calc( var(--xc-viewport-h, 100vh) - var(--xc-fold-y, calc(var(--xc-space-1) - var(--xc-space-1))) - var(--xc-fold-height, calc(var(--xc-space-1) - var(--xc-space-1))) ))');
        expect(body['grid-row']).toBe('2');
        expect(body['min-block-size']).toBe('0');
        expect(footer['grid-row']).toBe('4');
        expect(footer.display).toBe('flex');
        expect(footer['align-items']).toBe('flex-end');
    });
});
