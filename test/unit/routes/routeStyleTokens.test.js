// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { existsSync, readFileSync } from 'node:fs';
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
const obligations = readRouteCss('ObligationsView');

describe('route style tokens', () => {
    it('uses control, icon, type, and radius tokens for matching dimensions', () => {
        // In-field actions (U53) size the reveal toggle and every field icon to the shared tap target.
        expect(input).toContain('min-inline-size: var(--xc-tap-min);');
        expect(input).toContain('min-block-size: var(--xc-tap-min);');

        // The token page is TokenDetail now (G12); ManageToken.module.css keeps
        // only the identity card and details card the co-signer and View
        // Address pages borrow, so its unused lock and edit marks went with
        // the page. What is left uses no literal radius fallback.
        expect(manageToken).not.toMatch(/var\(--xc-radius-[^)]+,\s*\d+px\)/);

        expect(messagingInbox).toContain('width: var(--xc-icon-sm);');
        expect(messagingInbox).toContain('font-size: var(--xc-text-xs);');
        // The composer has no send button, so its input is one whole rounded field.
        expect(messagingInbox).toMatch(/\.composerInput\s*\{[^}]*border-radius:\s*var\(--xc-control-radius\);/s);
        expect(messagingInbox).toContain(
            'scroll-margin-top: calc(var(--xc-control-h-lg) + var(--xc-space-2));',
        );

        expect(obligations).toContain('border-radius: var(--xc-radius-pill);');
        expect(obligations).not.toContain('border-radius: 999px;');
    });

    it('documents exact pixel geometry that has no matching shared token', () => {
        expect(locked).toMatch(/\.logo\s*\{[^}]*composes:\s*standardSize from '\.\/BootLogo\.module\.css';/s);
        // The in-field action strip is inset by the G112 field-slot token, so no raw pixel inset remains.
        expect(input).toMatch(/\.controlActions\s*\{[^}]*inset-inline-end: var\(--xc-control-action-inset\);/s);
        expect(input).not.toContain('inset-inline-end: 2px;');
        expect(messagingInbox).toMatch(
            /\/\* Half-grid spacing keeps the two conversation lines visually connected\. \*\/\s*gap: 2px;/,
        );
        expect(obligations).toMatch(
            /\/\* The one-pixel block inset preserves the compact status-chip height\. \*\/\s*padding: 1px var\(--xc-space-2\);/,
        );
    });

    // MySwapsView draws its rows in the shared Form Standard components and
    // keeps no route stylesheet of its own (2026-11-15), so it has no pixel
    // literals to pin.
    it('gives MySwapsView no route stylesheet', () => {
        expect(existsSync(join(routeRoot, 'MySwapsView.module.css'))).toBe(false);
    });
});

describe('route styles use the shared geometry tokens (staking, settings)', () => {
    it('keeps Settings free of route-owned page gutters', () => {
        const css = readRouteCss('Settings');

        expect(css).not.toMatch(/padding(?:-inline|-left|-right)?:\s*\d+px/);
        expect(css).not.toContain('var(--xc-page-gutter)');
    });

    it('draws the stake chooser icons bare through the shared ActionList', () => {
        const css = readRouteCss('StakeNew');

        // No circle or tint behind a menu row's icon (ruling 2026-11-13).
        expect(css).not.toMatch(/\.optionIcon\s*\{/);
        expect(css).not.toMatch(/border-radius:\s*50%/);
        // The network step draws the standard network rows (NetworkPicker),
        // so the route sheet no longer sizes a chain icon of its own.
        expect(css).not.toMatch(/\.chainIcon\s*\{/);
    });

    it('tokens staking list icons, controls, spacing, radii, and ring', () => {
        const css = readRouteCss('StakingList');

        expect(css).toMatch(/\.iconWrap\s*\{[^}]*width:\s*var\(--xc-control-h-lg\);[^}]*height:\s*var\(--xc-control-h-lg\)/s);
        expect(css).toMatch(/\.chainOverlay\s*\{[^}]*width:\s*var\(--xc-icon-lg\);[^}]*height:\s*var\(--xc-icon-lg\)[^}]*box-shadow:\s*var\(--xc-shadow-surface-ring\)/s);
        expect(css).toMatch(/\.status\s*\{[^}]*border-radius:\s*var\(--xc-radius-pill\)/s);
        // The claimable panel is the shared card; its padding and radius come from it.
        expect(css).toMatch(/\.claimable\s*\{[^}]*composes:\s*card from '\.\.\/\.\.\/ui\/Card\.module\.css';[^}]*gap:\s*var\(--xc-space-3\);[^}]*margin-bottom:\s*var\(--xc-space-3\)/s);
    });

    it('documents untokenized route-specific measurements', () => {
        const unavailable = readRouteCss('VaultUnavailable');

        // The escape link is a kit Button now, so the route keeps no underline or focus offsets.
        expect(unavailable).not.toMatch(/text-underline-offset|outline-offset/);
    });
});
