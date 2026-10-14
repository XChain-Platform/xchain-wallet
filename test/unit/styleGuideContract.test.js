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
        const section = read('packages/web/src/style-guide/sections/ButtonsSection.jsx');
        for (const variant of ['primary', 'secondary', 'ghost', 'danger', 'success']) {
            expect(source).toContain(`'${variant}'`);
            expect(css).toMatch(new RegExp(`\\.${variant}\\s*\\{`));
            expect(guide).toMatch(new RegExp(`\`${variant}\``));
        }
        expect(source).toContain("size = 'md'");
        for (const size of ['sm', 'md', 'lg']) {
            expect(source).toContain(`'${size}'`);
            expect(css).toMatch(new RegExp(
                `\\.${size}\\s*\\{[^}]*--xc-button-height:\\s*var\\(--xc-control-h-${size}\\)`,
                's',
            ));
            expect(guide).toContain(`\`--xc-control-h-${size}\``);
        }
        expect(guide).toContain('`sm` | `--xc-control-h-sm`, 28px (36px on touch)');
        expect(guide).toContain('`md` | `--xc-control-h-md`, 36px (44px on touch)');
        expect(guide).toContain('`lg` | `--xc-control-h-lg`, 44px (48px on touch)');
        // Every badge geometry token in tokens.css has a row in the guide.
        const tokens = read('packages/core/src/ui/tokens.css');
        const badgeTokens = [...new Set(tokens.match(/--xc-badge-(?!multisig)[a-z-]+(?=:)/g))];
        expect(badgeTokens.length).toBeGreaterThan(0);
        for (const token of badgeTokens) expect(guide).toContain(`| \`${token}\` |`);
        expect(section).toMatch(/import \{ Button, Icon, Input \}/);
        expect(section).toMatch(/\['sm', 'md', 'lg'\]\.map/);
        expect(section).toMatch(/<Input[\s\S]*?size=\{size\}[\s\S]*?<Button[\s\S]*?size=\{size\}/);
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

    it('uses shared controls on the adopted advanced, list, signing, and staking routes', () => {
        const routeNames = [
            'AdvancedActionsForm.jsx',
            'MenuRoute.jsx',
            'MultisigSigningSession.jsx',
            'MyLists.jsx',
            'PsbtSignForm.jsx',
            'StakeNew.jsx',
            'StakingList.jsx',
        ];
        const routes = Object.fromEntries(routeNames.map((name) => [
            name,
            read('packages/core/src/shared/routes', name),
        ]));

        for (const [name, source] of Object.entries(routes)) {
            expect(source, name).not.toMatch(/<(?:input|select|textarea)\b/);
        }
        expect(routes['AdvancedActionsForm.jsx']).toMatch(/<Select[\s\S]*label="Action"/);
        expect(routes['AdvancedActionsForm.jsx']).toMatch(/<Textarea[\s\S]*list values/);
        expect(routes['MultisigSigningSession.jsx']).toMatch(/<Textarea[\s\S]*aria-label="Cosigner reply chunks"/);
        expect(routes['MyLists.jsx']).toMatch(/<Input[\s\S]*aria-label="Search lists"/);
        expect(routes['MyLists.jsx']).toMatch(/<Button[\s\S]*aria-label="Create list"/);
        expect(routes['PsbtSignForm.jsx']).toMatch(/<Select[\s\S]*label="Signing address"/);
        expect(routes['PsbtSignForm.jsx']).toMatch(/<Textarea[\s\S]*label="Unsigned transaction/);
        expect(routes['StakingList.jsx']).toMatch(/<Input[\s\S]*aria-label="Search staking positions"/);
        expect(routes['StakingList.jsx']).toMatch(/<Button[\s\S]*aria-label="New stake"/);
    });

    it('documents the shared Input size prop instead of inline big-field values', () => {
        const source = read('packages/core/src/ui/Input.jsx');
        const css = read('packages/core/src/ui/Input.module.css');
        const tokens = read('packages/core/src/ui/tokens.css');
        expect(source).toContain("size = 'md'");
        // Heights come from the shared control-size tokens, so the CSS names the
        // token per size and tokens.css owns the pixel values.
        expect(css).toMatch(/\.input:not\(textarea\)\s*\{[^}]*height:\s*var\(--xc-control-height\)/s);
        for (const [size, height] of [['sm', '28px'], ['md', '36px'], ['lg', '44px']]) {
            expect(css).toMatch(new RegExp(
                `\\.${size}\\s*\\{[^}]*--xc-control-height:\\s*var\\(--xc-control-h-${size}\\)`,
                's',
            ));
            expect(tokens).toContain(`--xc-control-h-${size}: ${height};`);
        }
        expect(guide).toContain('Its `size` prop is `sm` (28px), `md` (36px, default), or `lg` (44px');
        expect(guide).toContain('<Input label="Amount" size="lg" />');
        expect(guide).not.toContain("fontSize: 'var(--xc-text-lg)'");
    });

    it('documents kit usage decisions with do and do-not examples', () => {
        for (const heading of [
            '### The page gutter and vertical rhythm',
            '### The form rule: narrow is bare, wide is one card',
            '### ListRow versus a card',
            '### Control sizes: sm, md and lg',
            '### Chip versus SegmentedControl versus Tabs',
            '### Checkbox versus Switch versus RadioGroup',
        ]) {
            expect(guide).toContain(heading);
        }

        expect(guide).toContain('**Do:** let `<Screen>` provide `--xc-page-gutter`');
        expect(guide).toContain('**Do not:** branch on `screenVariantFor(shell)`');
        expect(guide).toContain('**Do:** render each history transaction as a `<ListRow');
        expect(guide.match(/\| control \| use it when \| do \| do not \|/g)).toHaveLength(2);
        for (const example of [
            '`Grouped / Flat` for history grouping',
            '`Balances / Activity / DeFi` above one connected tab panel',
            '`Include spam` and `Include testnet`',
            '`Hide balances` and save the change on toggle',
            '`Low / Normal / Fast` default fee priority',
        ]) {
            expect(guide).toContain(example);
        }
    });

    it('documents the FormPage breakpoint, full-width ListPage and EmptyState props', () => {
        const formCss = read('packages/core/src/ui/FormPage.module.css');
        const emptyState = read('packages/core/src/ui/EmptyState.jsx');
        expect(formCss).toContain('@media (min-width: 600px)');
        expect(guide).toContain('**Narrow, under 600px**');
        expect(guide).toContain('**Wide, 600px and up**');
        expect(guide).toContain('### The list rule: full width to the scrollbar');
        expect(guide).toContain('Do not wrap it in a card or add a centered maximum width');
        for (const prop of [
            'title', 'body', 'icon', 'actionLabel', 'onAction', 'actionIcon',
            'secondaryActionLabel', 'onSecondaryAction', 'secondaryActionIcon',
            'titleAs', 'role', 'className',
        ]) {
            expect(emptyState).toMatch(new RegExp(`\\b${prop}\\b`));
            expect(guide).toMatch(new RegExp(`\`${prop}\``));
        }
    });

    it('keeps documented token scales aligned with tokens.css', () => {
        const tokens = read('packages/core/src/ui/tokens.css');
        const names = [
            '--xc-space-1', '--xc-space-2', '--xc-space-3', '--xc-space-4', '--xc-space-5', '--xc-space-6', '--xc-space-8',
            '--xc-form-gap', '--xc-label-gap', '--xc-help-gap', '--xc-section-gap',
            '--xc-control-h-sm', '--xc-control-h-md', '--xc-control-h-lg',
            '--xc-text-xs', '--xc-text-sm', '--xc-text-md', '--xc-text-lg', '--xc-text-xl', '--xc-text-2xl',
            '--xc-icon-xs', '--xc-icon-sm', '--xc-icon-md', '--xc-icon-lg', '--xc-icon-xl',
            '--xc-radius-sm', '--xc-radius-md', '--xc-radius-lg', '--xc-radius-pill',
            '--xc-shadow-sm', '--xc-shadow-md',
            '--xc-z-base', '--xc-z-sticky', '--xc-z-dropdown', '--xc-z-overlay', '--xc-z-modal', '--xc-z-toast',
        ];
        for (const name of names) {
            const value = new RegExp(`${name}:\\s*([^;]+);`).exec(tokens)?.[1].trim();
            expect(value, name).toBeTruthy();
            const plainValue = `| \`${name}\` | ${value} |`;
            const codeValue = `| \`${name}\` | \`${value}\` |`;
            expect(
                guide.includes(plainValue) || guide.includes(codeValue),
                `${name} is documented with its token value`,
            ).toBe(true);
        }
    });

    it('documents semantic status tokens, shared icon sizing and the browser baseline', () => {
        const tokens = read('packages/core/src/ui/tokens.css');
        const icons = read('packages/core/src/ui/icons/index.jsx');
        for (const name of [
            '--xc-danger', '--xc-danger-fg', '--xc-danger-bg', '--xc-danger-text', '--xc-on-danger',
            '--xc-info', '--xc-info-bg', '--xc-info-text',
            '--xc-warning', '--xc-warning-bg', '--xc-warning-text',
            '--xc-success', '--xc-success-fill', '--xc-success-bg', '--xc-on-success',
        ]) {
            expect(tokens).toContain(`${name}:`);
            expect(guide).toContain(`\`${name}\``);
        }
        expect(tokens).toContain(':where(svg[data-xc-icon])');
        expect(icons).toContain("'data-xc-icon': ''");
        expect(guide).toContain('Shared icons are sized by the `svg[data-xc-icon]` rule in `tokens.css`');
        expect(guide).toContain('Never put `var()` in an SVG sizing attribute');
        expect(guide).toContain('Chrome 102 is the oldest supported Android WebView engine');
    });

    it('documents sentence case and canonical wallet terminology', () => {
        expect(guide).toContain('Use sentence case for page titles, headings, buttons, menu items, field labels and status messages.');
        expect(guide).toContain('say **recovery phrase**, not seed phrase or mnemonic');
        expect(guide).toContain('**network fee**, not transaction fee, miner fee or gas fee');
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
