// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Settings > About is the Titled Sections layout (operator pick 4, 2026-11-15):
// the logo and plain intro on top, then four titled sections in a fixed order.
// This pins the page title, the section titles in order, every item and the
// logo, so a later restyle cannot drop a fact or reorder the sections.

import { readFileSync } from 'node:fs';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { AboutSection } from '../../../packages/core/src/shared/components/settings/AboutSection.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { t } from '../../../packages/core/src/i18n/index.js';
import '../../../packages/core/src/i18n/locales/en/settings.js';
import '../../../packages/core/src/i18n/locales/en/routes.js';

afterEach(cleanup);

function mount() {
    return render(
        <MessagingProvider
            shell="web"
            messaging={{ getDiagnosticDump: vi.fn(async () => ({ build: { gitCommit: 'abc123def456' } })) }}
        >
            <AboutSection balancesFetchedAt={Date.now() - 5 * 60_000} />
        </MessagingProvider>,
    );
}

/** One section's list, found by its accessible name. */
function sectionList(name) {
    return screen.getByRole('list', { name });
}

describe('About: Titled Sections layout', () => {
    it('is titled About, never About XChain Wallet', () => {
        expect(t('settings.about.pageTitle')).toBe('About');
        expect(t('settings.about.pageTitle')).not.toMatch(/XChain/);
    });

    it('shows the large logo, then the intro as plain text outside any notice card', () => {
        const { container } = mount();
        const logo = screen.getByTestId('about-logo');
        expect(logo.tagName).toBe('IMG');
        expect(logo.getAttribute('alt')).toBe('XChain');
        expect(logo.getAttribute('width')).toBe('170');
        expect(logo.getAttribute('src')).toBeTruthy();
        const intro = screen.getByTestId('about-intro');
        expect(intro.tagName).toBe('P');
        expect(intro.textContent).toBe('A self-custodial wallet for the XChain Platform.');
        // Logo first, intro under it, both before the first section.
        const first = container.querySelector('section');
        expect(logo.compareDocumentPosition(intro) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(intro.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(intro.closest('[role="alert"], [role="status"]')).toBeNull();
    });

    it('titles four sections in order', () => {
        mount();
        const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
        expect(titles).toEqual(['Version and build', 'License', 'Verification', 'Support']);
    });

    it('puts the facts first, then the update action in Version and build', async () => {
        mount();
        const list = sectionList('Version and build');
        const build = within(list).getAllByRole('listitem').map((li) => li.textContent);
        ['Version', 'Build identifier', 'Platform', 'Update channel', 'Balances updated']
            .forEach((label, i) => expect(build[i].startsWith(label), label).toBe(true));
        expect(await screen.findByText('abc123def456')).toBeTruthy();
        expect(screen.getByText('5 minutes ago')).toBeTruthy();
        const actions = within(list).getAllByRole('button');
        expect(actions).toHaveLength(1);
        expect(actions[0]).toHaveTextContent(/^Check for Updates/);
        expect(build[5]).toContain('See whether this wallet is on the latest published version.');
        expect(within(list).queryAllByRole('link')).toHaveLength(0);
    });

    // Layout 5's row style for every tappable item: icon, title, description, chevron.
    const ROWS = [
        ['License', 'License', 'Free software under the GNU AGPL v3.0 or later.', true],
        ['License', 'Notice', 'Third-party notices', true],
        ['Verification', 'Reproducible build', 'How to rebuild this version and match its hash', true],
        ['Verification', 'Verify a release', 'Import the key, check the signed manifest and file hashes', true],
        ['Verification', 'Release signatures', 'GPG fingerprint', true],
        ['Verification', 'Disclosure policy', 'How to report a security issue', true],
    ];
    it.each(ROWS)('draws %s > %s as an action row: icon, title, description', (section, title, description, chevron) => {
        mount();
        const item = within(sectionList(section)).getAllByRole('listitem')
            .find((li) => li.textContent.startsWith(title));
        expect(item, title).toBeTruthy();
        expect(item.textContent).toContain(description);
        // The shared action-list row: icon tile plus title and description lines.
        const hidden = item.querySelectorAll('[aria-hidden="true"]');
        expect(hidden[0].querySelector('svg'), 'icon').toBeTruthy();
        expect(item.textContent.length).toBeGreaterThan(title.length + description.length - 1);
        // Every document row ends in the same standard chevron.
        const chevrons = [...hidden].filter((el) => el !== hidden[0] && el.querySelector('svg'));
        expect(chevrons.length > 0, 'chevron').toBe(chevron);
    });

    it('draws Support rows the same way as the License and Verification rows', () => {
        mount();
        const support = within(sectionList('Support')).getAllByRole('listitem');
        const license = within(sectionList('License')).getAllByRole('listitem');
        expect(support[1].className).toBe(license[0].className);
        expect(support[1].firstElementChild.className).toBe(license[0].firstElementChild.className);
    });

    it('offers the update switch only on a directly installed build, inside Version and build', () => {
        mount();
        // No direct update lane in the test shell, so the switch row does not exist.
        expect(screen.queryByRole('switch', { name: 'Check for new versions' })).toBeNull();
    });

    it('keeps Support as an action list with the two actions', () => {
        mount();
        const support = within(sectionList('Support')).getAllByRole('button');
        expect(support).toHaveLength(2);
        expect(support[0]).toHaveTextContent(/^Copy diagnostics/);
        expect(support[1]).toHaveTextContent(/^Report a problem/);
    });

    it('renders every document row as an external link and shows no file names', () => {
        const { container } = mount();
        const documentLinks = [
            ...within(sectionList('License')).getAllByRole('link'),
            ...within(sectionList('Verification')).getAllByRole('link'),
        ];
        expect(documentLinks).toHaveLength(6);
        documentLinks.forEach((link) => {
            expect(link.getAttribute('href')).toMatch(/^https:\/\//);
            expect(link).toHaveAttribute('target', '_blank');
            expect(link).toHaveAttribute('rel', 'noreferrer noopener');
        });
        expect(container.textContent).not.toMatch(/\.(?:md|txt)\b/i);
        expect(screen.getByText('Third-party notices')).toBeTruthy();
        expect(screen.getByText('How to report a security issue')).toBeTruthy();
    });

    it('puts each section in one rounded list card with its own border', () => {
        mount();
        for (const name of ['Version and build', 'License', 'Verification', 'Support']) {
            const list = sectionList(name);
            expect(list.style.border, name).toContain('var(--xc-border)');
            expect(list.style.borderRadius, name).toBe('var(--xc-radius-md)');
        }
        // The facts are one card: all five fact rows sit in the one list.
        expect(within(sectionList('Version and build')).getAllByRole('listitem').length).toBeGreaterThanOrEqual(5);
    });

    it('uses the responsive Settings form frame for its outer card (G126)', () => {
        const src = readFileSync('packages/core/src/shared/routes/Settings.jsx', 'utf8');
        const flat = src.match(/const FLAT_GROUP_PAGES = new Set\(\[([\s\S]*?)\]\);/);
        const framed = src.match(/const FORM_FRAME_PAGES = new Set\(\[([\s\S]*?)\]\);/);
        expect(flat[1]).not.toContain("'about'");
        expect(framed[1]).toContain("'about'");
    });

    it('has no collapsible sections', () => {
        const { container } = mount();
        expect(container.querySelector('[aria-expanded]')).toBeNull();
        expect(container.querySelector('details')).toBeNull();
    });
});
