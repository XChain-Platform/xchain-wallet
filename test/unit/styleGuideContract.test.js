// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8');
const guide = read('STYLE_GUIDE.md');

describe('STYLE_GUIDE component contracts', () => {
    it('lists every supported Button variant and size', () => {
        const source = read('packages/core/src/ui/Button.jsx');
        const css = read('packages/core/src/ui/Button.module.css');
        for (const variant of ['primary', 'secondary', 'ghost', 'danger', 'success']) {
            expect(source).toContain(`'${variant}'`);
            expect(css).toMatch(new RegExp(`\\.${variant}\\s*\\{`));
            expect(guide).toMatch(new RegExp(`\`${variant}\``));
        }
        expect(source).toContain("size = 'md'");
        expect(css).toMatch(/\.md\s*\{[^}]*min-height:\s*36px/s);
        expect(css).toMatch(/\.sm\s*\{[^}]*min-height:\s*28px/s);
        expect(guide).toContain('`md` (36px minimum height, default)');
        expect(guide).toContain('`sm` (28px minimum height)');
    });

    it('uses shared Button variants for shared call-to-action controls', () => {
        const amountField = read('packages/core/src/shared/components/AmountField.jsx');
        const alertsOverlay = read('packages/core/src/shared/components/AlertsOverlay.jsx');
        const alertsRoute = read('packages/core/src/shared/routes/AlertsRoute.jsx');
        const menuRoute = read('packages/core/src/shared/routes/MenuRoute.jsx');
        const amountFieldCss = read('packages/core/src/shared/components/AmountField.module.css');
        const alertsCss = read('packages/core/src/shared/components/AlertsOverlay.module.css');
        const menuCss = read('packages/core/src/shared/components/HeaderActionMenu.module.css');

        expect(amountField).toMatch(/<Button[\s\S]*?aria-label="Use max available amount"/);
        expect(alertsOverlay).toMatch(/<Button[\s\S]*?a\.action\.label/);
        expect(alertsRoute).toMatch(/<Button[\s\S]*?a\.action\.label/);
        expect(menuRoute).toMatch(/<Button[\s\S]*?variant="danger"[\s\S]*?Lock wallet/);
        expect(amountField).not.toContain('className={styles.amountMaxInline}');
        expect(alertsOverlay).not.toContain('className={styles.alertAction}');
        expect(alertsRoute).not.toContain('className={styles.alertAction}');
        expect(menuRoute).not.toContain('className={menuStyles.lockBtn}');
        expect(amountFieldCss).not.toMatch(/\.amountMaxInline\s*\{/);
        expect(alertsCss).not.toMatch(/\.alertAction\s*\{/);
        expect(menuCss).not.toMatch(/\.lockBtn\s*\{/);
    });

    it('documents the shared Input size prop instead of inline big-field values', () => {
        const source = read('packages/core/src/ui/Input.jsx');
        const css = read('packages/core/src/ui/Input.module.css');
        expect(source).toContain("size = 'md'");
        expect(css).toMatch(/\.input\s*\{[^}]*min-height:\s*36px/s);
        expect(css).toMatch(/\.lg \.input\s*\{[^}]*min-height:\s*48px/s);
        expect(guide).toContain('Its `size` prop is `md` (36px minimum height, default) or `lg` (48px minimum height');
        expect(guide).toContain('<Input label="Amount" size="lg" />');
        expect(guide).not.toContain("fontSize: 'var(--xc-text-lg)'");
    });

    it('matches the FormPage viewport breakpoint and EmptyState props', () => {
        const formCss = read('packages/core/src/ui/FormPage.module.css');
        const emptyState = read('packages/core/src/ui/EmptyState.jsx');
        expect(formCss).toContain('@media (min-width: 600px)');
        expect(guide).toContain('**Narrow, under 600px**');
        expect(guide).toContain('**Wide, 600px and up**');
        for (const prop of [
            'title', 'body', 'icon', 'actionLabel', 'onAction', 'actionIcon', 'titleAs', 'role', 'className',
        ]) {
            expect(emptyState).toMatch(new RegExp(`\\b${prop}\\b`));
            expect(guide).toMatch(new RegExp(`\`${prop}\``));
        }
    });

    it('keeps documented spacing and type values aligned with tokens.css', () => {
        const tokens = read('packages/core/src/ui/tokens.css');
        const names = [
            '--xc-space-1', '--xc-space-2', '--xc-space-3', '--xc-space-4', '--xc-space-5', '--xc-space-6', '--xc-space-8',
            '--xc-text-xs', '--xc-text-sm', '--xc-text-md', '--xc-text-lg', '--xc-text-xl', '--xc-text-2xl',
        ];
        for (const name of names) {
            const value = new RegExp(`${name}:\\s*([^;]+);`).exec(tokens)?.[1].trim();
            expect(value, name).toBeTruthy();
            expect(guide).toContain(`| \`${name}\` | ${value} |`);
        }
    });

    it('points composed fields at their implemented shared components', () => {
        expect(read('packages/core/src/shared/components/AmountField.jsx')).toContain('export function AmountField');
        expect(read('packages/core/src/ui/AddressCombobox.jsx')).toContain('export const AddressCombobox');
        expect(read('packages/core/src/shared/components/TokenField.jsx')).toContain('export function TokenField');
        expect(guide).toContain("@xchain-wallet/core/shared/components/AmountField.jsx");
        expect(guide).toContain('icon="contacts"');
        expect(guide).toContain("@xchain-wallet/core/shared/components/TokenField.jsx");
        expect(guide).not.toContain('same `.bigField` treatment');
    });
});
