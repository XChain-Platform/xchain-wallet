// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const readCore = (...parts) => readFileSync(
    join(root, 'packages', 'core', 'src', ...parts),
    'utf8',
);

function rule(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] || '';
}

const headingStyles = [
    ['ui/PageHeader.module.css', '.title', 'page-title'],
    ['ui/SectionHeader.module.css', '.title', 'section-title'],
    ['ui/EmptyState.module.css', '.title', 'card-title'],
    ['shared/components/BackupReminderCard.module.css', '.headline', 'card-title'],
    ['shared/components/BalanceChanges.module.css', '.heading', 'card-title'],
    ['shared/components/EmptyStateNudge.module.css', '.title', 'card-title'],
    ['shared/components/HomeTabs.module.css', '.placeholderTitle', 'card-title'],
    ['shared/components/QueuedResultPanel.module.css', '.queuedTitle', 'card-title'],
    ['shared/components/RouteErrorBoundary.module.css', '.title', 'page-title'],
];

const bodyStyles = [
    ['ui/SectionHeader.module.css', '.description'],
    ['ui/EmptyState.module.css', '.body'],
    ['shared/components/BackupReminderCard.module.css', '.copy'],
    ['shared/components/EmptyStateNudge.module.css', '.body'],
    ['shared/components/HomeTabs.module.css', '.placeholderBody'],
    ['shared/components/QueuedResultPanel.module.css', '.queuedHint'],
    ['shared/components/RouteErrorBoundary.module.css', '.body'],
];

describe('heading type scale', () => {
    it('defines the page, section, card, and body roles from the fixed text tiers', () => {
        const tokens = readCore('ui', 'tokens.css');

        expect(tokens).toContain('--xc-type-page-title-size: var(--xc-text-lg);');
        expect(tokens).toContain('--xc-type-section-title-size: var(--xc-text-md);');
        expect(tokens).toContain('--xc-type-card-title-size: var(--xc-text-md);');
        expect(tokens).toContain('--xc-type-body-size: var(--xc-text-sm);');
        for (const role of ['page-title', 'section-title', 'card-title', 'body']) {
            expect(tokens).toMatch(new RegExp(`--xc-type-${role}-weight:\\s*\\d+;`));
        }
    });

    it.each(headingStyles)('%s %s uses the %s role', (file, selector, role) => {
        const css = readCore(...file.split('/'));
        const declaration = rule(css, selector);

        expect(declaration).toContain(`font-size: var(--xc-type-${role}-size)`);
        expect(declaration).toContain(`font-weight: var(--xc-type-${role}-weight)`);
    });

    it.each(bodyStyles)('%s %s uses the body role', (file, selector) => {
        const css = readCore(...file.split('/'));
        const declaration = rule(css, selector);

        expect(declaration).toContain('font-size: var(--xc-type-body-size)');
        expect(declaration).toContain('font-weight: var(--xc-type-body-weight)');
    });

    it('maps FormSection titles through the shared section heading', () => {
        const formSection = readCore('ui', 'FormSection.jsx');

        expect(formSection).toContain("import { SectionHeader } from './SectionHeader.jsx';");
        expect(formSection).toMatch(/<SectionHeader[\s\S]*title=\{title\}/);
    });
});
