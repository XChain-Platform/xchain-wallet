// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const routeRoot = join(process.cwd(), 'packages/core/src/shared/routes');
const readRouteCss = (name) => readFileSync(join(routeRoot, `${name}.module.css`), 'utf8');

const locked = readRouteCss('Locked');
// The Locked screen's password show and hide button moved into the shared
// Input, so its geometry is checked there.
const input = readFileSync(join(process.cwd(), 'packages/core/src/ui/Input.module.css'), 'utf8');
const manageToken = readRouteCss('ManageToken');
const messagingInbox = readRouteCss('MessagingInbox');
const mySwaps = readRouteCss('MySwapsView');
const obligations = readRouteCss('ObligationsView');

describe('route style tokens', () => {
    it('uses control, icon, type, and radius tokens for matching dimensions', () => {
        expect(input).toContain('min-height: var(--xc-control-h-sm);');
        expect(input).toContain('width: calc(var(--xc-control-h-md) - var(--xc-space-1));');

        expect(manageToken).toContain('width: var(--xc-icon-xs);');
        expect(manageToken).toContain('width: var(--xc-icon-md);');
        expect(manageToken).toContain('width: var(--xc-icon-sm);');
        expect(manageToken).toContain('min-height: calc(var(--xc-control-h-lg) + var(--xc-space-6));');
        expect(manageToken).toContain('font-size: var(--xc-text-xs);');
        expect(manageToken).not.toMatch(/var\(--xc-radius-[^)]+,\s*\d+px\)/);

        expect(messagingInbox).toContain('width: var(--xc-icon-sm);');
        expect(messagingInbox).toContain('font-size: var(--xc-text-xs);');
        expect(messagingInbox).toContain('border-start-start-radius: var(--xc-control-radius)');
        expect(messagingInbox).toContain(
            'scroll-margin-top: calc(var(--xc-control-h-lg) + var(--xc-space-2));',
        );

        expect(obligations).toContain('border-radius: var(--xc-radius-pill);');
        expect(obligations).not.toContain('border-radius: 999px;');
    });

    it('documents exact pixel geometry that has no matching shared token', () => {
        expect(locked).toMatch(
            /\/\* The brand mark has no matching size token at its default presentation width\. \*\/\s*width: 96px;/,
        );
        expect(input).toMatch(
            /\/\* This half-grid inset keeps the toggle centered inside the input border\. \*\/\s*inset-inline-end: 2px;/,
        );
        expect(manageToken).toMatch(
            /\/\* The slim progress track has no matching control or spacing token\. \*\/\s*height: 6px;/,
        );
        expect(messagingInbox).toMatch(
            /\/\* Half-grid spacing keeps the two conversation lines visually connected\. \*\/\s*gap: 2px;/,
        );
        expect(obligations).toMatch(
            /\/\* The one-pixel block inset preserves the compact status-chip height\. \*\/\s*padding: 1px var\(--xc-space-2\);/,
        );
    });

    it('leaves MySwapsView free of pixel literals outside its breakpoint', () => {
        expect(mySwaps.replace('@media (max-width: 420px)', '')).not.toMatch(/\d+px/);
    });
});

describe('route styles use the shared geometry tokens (staking, settings, wizard)', () => {
    it('keeps Settings free of route-owned page gutters', () => {
        const css = readRouteCss('Settings');

        expect(css).not.toMatch(/padding(?:-inline|-left|-right)?:\s*\d+px/);
        expect(css).not.toContain('var(--xc-page-gutter)');
    });

    it('tokens stake chooser control and icon sizes', () => {
        const css = readRouteCss('StakeNew');

        expect(css).toMatch(/\.optionIcon\s*\{[^}]*width:\s*var\(--xc-control-h-md\);[^}]*height:\s*var\(--xc-control-h-md\)/s);
        expect(css).toMatch(/\.chainIcon\s*\{[^}]*width:\s*var\(--xc-icon-xl\);[^}]*height:\s*var\(--xc-icon-xl\)/s);
    });

    it('tokens staking list icons, controls, spacing, radii, and ring', () => {
        const css = readRouteCss('StakingList');

        expect(css).toMatch(/\.iconWrap\s*\{[^}]*width:\s*var\(--xc-control-h-lg\);[^}]*height:\s*var\(--xc-control-h-lg\)/s);
        expect(css).toMatch(/\.chainOverlay\s*\{[^}]*width:\s*var\(--xc-icon-lg\);[^}]*height:\s*var\(--xc-icon-lg\)[^}]*box-shadow:\s*var\(--xc-shadow-surface-ring\)/s);
        expect(css).toMatch(/\.addBtn\s*\{[^}]*width:\s*var\(--xc-control-h-md\);[^}]*height:\s*var\(--xc-control-h-md\)/s);
        expect(css).toMatch(/\.status\s*\{[^}]*border-radius:\s*var\(--xc-radius-pill\)/s);
        // The claimable panel is the shared card; its padding and radius come from it.
        expect(css).toMatch(/\.claimable\s*\{[^}]*composes:\s*card from '\.\.\/\.\.\/ui\/Card\.module\.css';[^}]*gap:\s*var\(--xc-space-3\);[^}]*margin-bottom:\s*var\(--xc-space-3\)/s);
    });

    it('documents untokenized route-specific measurements', () => {
        const wizard = readRouteCss('TokenWizard');
        const unavailable = readRouteCss('VaultUnavailable');

        expect(wizard).toMatch(/\/\* The fixed measure[^*]+\*\/\s*max-width:\s*560px/);
        // The wizard's checkboxes are kit Checkbox controls, so no native-box offset remains.
        expect(wizard).not.toMatch(/\.checkRow/);
        // The escape link is a kit Button now, so the route keeps no underline or focus offsets.
        expect(unavailable).not.toMatch(/text-underline-offset|outline-offset/);
    });
});
