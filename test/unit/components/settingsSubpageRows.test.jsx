// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Settings subpages share the index's row rhythm: one row gap token between
// stacked rows and one bordered row component for every row.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { KeyboardSection } from '../../../packages/core/src/shared/components/settings/KeyboardSection.jsx';
import { ROW_LAYOUT, SettingsActionRow, SettingsFieldRow } from '../../../packages/core/src/shared/components/settings/_settingsPrimitives.jsx';
import cardStyles from '../../../packages/core/src/ui/Card.module.css';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';

const SETTINGS_DIR = join(process.cwd(), 'packages/core/src/shared');

function mount(ui, settings = {}) {
    const messaging = {
        getSettings: vi.fn(async () => settings),
        updateSettings: vi.fn(async (patch) => ({ ...settings, ...patch })),
    };
    return render(
        <MessagingContext.Provider value={{ messaging, shell: 'web' }}>
            {ui}
        </MessagingContext.Provider>,
    );
}

afterEach(() => {
    cleanup();
});

describe('Settings subpage row gap', () => {
    it('gives FormSection-based subpages the Settings row gap', () => {
        const css = readFileSync(join(SETTINGS_DIR, 'routes/Settings.module.css'), 'utf8');
        const page = css.match(/\.page\s*\{([^}]*)\}/)[1];
        expect(page).toMatch(/--xc-settings-row-gap:\s*var\(--xc-space-2\)/);
        expect(page).toMatch(/--xc-section-gap:\s*var\(--xc-settings-row-gap\)/);
        expect(page).toMatch(/--xc-form-gap:\s*var\(--xc-settings-row-gap\)/);
    });

    it('stacks This wallet rows on the Settings row gap', () => {
        const css = readFileSync(join(SETTINGS_DIR, 'components/settings/ThisWalletSection.module.css'), 'utf8');
        const stack = css.match(/\.stack\s*\{([^}]*)\}/)[1];
        expect(stack).toMatch(/gap:\s*var\(--xc-settings-row-gap\)/);
    });

    it('separates keyboard shortcut rows by the Settings row gap', async () => {
        const { container } = mount(<KeyboardSection />);
        await waitFor(() => expect(container.querySelectorAll('section').length).toBeGreaterThan(1));
        for (const section of container.querySelectorAll('section')) {
            expect(section.style.gap).toBe('var(--xc-settings-row-gap)');
            expect(section.style.flexDirection).toBe('column');
        }
    });
});

describe('Settings action rows', () => {
    it('draws an action row with the shared bordered row and keeps its actions at the row end', () => {
        const { container, getByRole } = render(
            <SettingsActionRow label="Back up recovery phrase" hint="Reveal the words.">
                <button type="button">Show…</button>
            </SettingsActionRow>,
        );
        const row = container.firstElementChild;
        // The row is the shared card; its inline style carries only layout.
        expect(row).toHaveClass(cardStyles.card);
        expect(row.style.display).toBe(ROW_LAYOUT.display);
        expect(row.style.border).toBe('');
        expect(getByRole('heading', { name: 'Back up recovery phrase' })).toBeTruthy();
        // The label never names the button, so its accessible name stays its own text.
        expect(getByRole('button', { name: 'Show…' })).toBeTruthy();
        const slot = getByRole('button').parentElement;
        expect(slot.style.marginInlineStart).toBe('auto');
        expect(slot.style.justifyContent).toBe('flex-end');
    });

    it('builds Backup and This wallet rows from the shared action row', () => {
        for (const file of ['BackupSection.jsx', 'ThisWalletSection.jsx']) {
            const src = readFileSync(join(SETTINGS_DIR, 'components/settings', file), 'utf8');
            expect(src, file).toMatch(/<SettingsActionRow/);
            expect(src, file).not.toMatch(/trailing=\{/);
        }
    });

    it('frames an opened Backup or This wallet row with the shared card, like a row', () => {
        for (const name of ['BackupSection', 'ThisWalletSection']) {
            const src = readFileSync(join(SETTINGS_DIR, `components/settings/${name}.jsx`), 'utf8');
            const css = readFileSync(join(SETTINGS_DIR, `components/settings/${name}.module.css`), 'utf8');
            // A row and an opened section are both the shared card, with no
            // card styling of the section's own.
            expect(src, name).toMatch(/className=\{cardStyles\.card\}/);
            expect(src, name).not.toMatch(/styles\.(formSection|panel|keyPanel)\b/);
            expect(css, name).not.toMatch(/composes:\s*(card|flush) from/);
            expect(css, name).not.toMatch(/dangerPanel/);
        }
    });
});

describe('Settings field rows', () => {
    it('keeps a field row control in an end slot that fills the line on a phone', () => {
        const { getByLabelText } = render(
            <SettingsFieldRow label="Format" hint="How numbers show.">
                <select><option>Full</option></select>
            </SettingsFieldRow>,
        );
        const slot = getByLabelText('Format').parentElement;
        expect(slot.hasAttribute('data-settings-control')).toBe(true);
        expect(slot.style.marginInlineStart).toBe('auto');
        const css = readFileSync(join(SETTINGS_DIR, 'routes/Settings.module.css'), 'utf8');
        const phone = css.slice(css.indexOf('@media (max-width: 480px)'));
        expect(phone).toMatch(/\.page \[data-settings-control\]\s*\{\s*flex:\s*1 1 100%/);
    });

    it('lets the fiat currency box fill the line on a phone like the dropdowns', () => {
        const src = readFileSync(join(SETTINGS_DIR, 'components/settings/LanguageRegionSection.jsx'), 'utf8');
        expect(src).toMatch(/data-settings-fill="" style=\{CONTROLS\}/);
        const css = readFileSync(join(SETTINGS_DIR, 'routes/Settings.module.css'), 'utf8');
        const phone = css.slice(css.indexOf('@media (max-width: 480px)'));
        expect(phone).toMatch(/\.page \[data-settings-fill\]\s*\{\s*width:\s*100% !important/);
    });

    it('draws Developer mode rows as bordered rows, like every other subpage', () => {
        const src = readFileSync(join(SETTINGS_DIR, 'components/settings/DeveloperModeSection.jsx'), 'utf8');
        expect(src).not.toMatch(/^\s*embedded\s*$/m);
    });
});

describe('About rows', () => {
    it('keeps a wrapped About value at the row end', () => {
        const src = readFileSync(join(SETTINGS_DIR, 'components/settings/AboutSection.jsx'), 'utf8');
        const rowEnd = src.match(/const ROW_END = \{([^}]*)\}/)[1];
        expect(rowEnd).toMatch(/marginInlineStart: 'auto'/);
        expect(rowEnd).toMatch(/justifyContent: 'flex-end'/);
        expect(src).toMatch(/<div style=\{ROW_END\}>\{children\}<\/div>/);
    });
});
