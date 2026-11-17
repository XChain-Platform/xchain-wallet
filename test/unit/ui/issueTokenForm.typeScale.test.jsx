// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Switch } from '../../../packages/core/src/ui/Switch.jsx';

const root = process.cwd();
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const issueCss = read('packages/core/src/shared/routes/IssueTokenForm.module.css');
const issueJsx = read('packages/core/src/shared/routes/IssueTokenForm.jsx');
const switchCss = read('packages/core/src/ui/Switch.module.css');

describe('Issue Token form type scale', () => {
    it('sets every font-size from the shared type tokens, never a literal', () => {
        const sizes = [...issueCss.matchAll(/font-size\s*:\s*([^;]+);/g)].map((m) => m[1].trim());
        expect(sizes.length).toBeGreaterThan(0);
        for (const size of sizes) {
            expect(size, `font-size ${size}`).toMatch(/^var\(--xc-(text-(xs|sm|md|lg|xl)|control-font-(sm|md|lg))\)$/);
        }
    });

    it('draws each lock as one shared Switch row with its icon in the Switch icon slot', () => {
        const block = issueJsx.slice(issueJsx.indexOf('ISSUE_LOCKS.map'));
        const sw = block.slice(0, block.indexOf('onChange'));
        expect(sw).toContain('<Switch');
        expect(sw).toContain('icon={<ItemIcon />}');
        // No hand-built icon span or row wrapper beside the Switch.
        expect(issueJsx).not.toMatch(/styles\.lockIcon/);
        expect(issueCss).not.toMatch(/\.lockIcon/);
        expect(issueCss).not.toMatch(/align-items:\s*flex-start/);
    });

    it('raises the lock rows to the list-row scale through the Switch size variables', () => {
        const rule = issueCss.match(/\.lockRow\s*\{([^}]*)\}/)[1];
        expect(rule).toContain('--xc-switch-label-size: var(--xc-text-md)');
        expect(rule).toContain('--xc-switch-description-size: var(--xc-text-sm)');
        expect(switchCss).toMatch(/\.root\s*\{[^}]*align-items:\s*center/);
        expect(switchCss).toMatch(/\.icon\s*\{[^}]*align-items:\s*center/);
    });

    it('gives every lock its own item icon, never a lock or unlock glyph, in both forms', async () => {
        const { LOCK_FLAGS } = await import('../../../packages/core/src/shared/utils/issueAdvancedFields.js');
        const { lockIconFor } = await import('../../../packages/core/src/shared/routes/lockIcons.js');
        const { Icon } = await import('@xchain-wallet/core/ui');
        const icons = LOCK_FLAGS.map((f) => lockIconFor(f.field));
        for (const icon of icons) {
            expect(icon).toBeTypeOf('function');
            expect(icon).not.toBe(Icon.LockIcon);
            expect(icon).not.toBe(Icon.UnlockIcon);
            expect(icon).not.toBe(Icon.TokenIcon);
        }
        expect(new Set(icons).size).toBe(icons.length);
        const adminJsx = read('packages/core/src/shared/routes/TokenAdminForm.jsx');
        const adminRowsStart = adminJsx.indexOf('LOCK_FLAGS.map((f)');
        const adminRows = adminJsx.slice(adminRowsStart, adminJsx.indexOf('token-admin-lock-', adminRowsStart));
        const issueRowsStart = issueJsx.indexOf('ISSUE_LOCKS.map');
        const issueRows = issueJsx.slice(issueRowsStart, issueJsx.indexOf('</FormSection>', issueRowsStart));
        for (const rows of [adminRows, issueRows]) {
            expect(rows).toContain('lockIconFor(');
            expect(rows).not.toMatch(/Icon\.(Lock|Unlock)Icon/);
        }
    });

    it('insets the Lock form rows by the shared list-row token on both sides', () => {
        const rule = issueCss.match(/\.lockFlagList > \.lockRow\s*\{([^}]*)\}/)[1];
        expect(rule).toContain('padding-inline: var(--xc-list-row-padding)');
        expect(read('packages/core/src/ui/tokens.css')).toMatch(/--xc-list-row-padding:\s*var\(--xc-space-2\)/);
    });

    it('renders the Switch icon as a row child ahead of the copy', () => {
        render(<Switch label="Max supply" icon={<svg data-testid="lk" />} checked={false} onChange={() => {}} />);
        const row = screen.getByTestId('lk').closest('label');
        const icon = screen.getByTestId('lk').parentElement;
        expect(icon.parentElement).toBe(row);
        expect(row.firstElementChild).toBe(icon);
        expect(icon.getAttribute('aria-hidden')).toBe('true');
    });
});
