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
const manageToken = readRouteCss('ManageToken');
const messagingInbox = readRouteCss('MessagingInbox');
const mySwaps = readRouteCss('MySwapsView');
const obligations = readRouteCss('ObligationsView');

describe('route style tokens', () => {
    it('uses control, icon, type, and radius tokens for matching dimensions', () => {
        expect(locked).toContain('min-height: var(--xc-control-h-sm);');
        expect(locked).toContain('width: calc(var(--xc-control-h-md) - var(--xc-space-1));');

        expect(manageToken).toContain('width: var(--xc-icon-xs);');
        expect(manageToken).toContain('width: var(--xc-icon-md);');
        expect(manageToken).toContain('width: var(--xc-icon-sm);');
        expect(manageToken).toContain('min-height: calc(var(--xc-control-h-lg) + var(--xc-space-6));');
        expect(manageToken).toContain('font-size: var(--xc-text-xs);');
        expect(manageToken).not.toMatch(/var\(--xc-radius-[^)]+,\s*\d+px\)/);

        expect(messagingInbox).toContain('width: var(--xc-icon-sm);');
        expect(messagingInbox).toContain('font-size: var(--xc-text-xs);');
        expect(messagingInbox).toContain('border-radius: var(--xc-control-radius)');
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
        expect(locked).toMatch(
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
