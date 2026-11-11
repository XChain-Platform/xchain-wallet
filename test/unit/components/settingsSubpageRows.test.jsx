// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Settings pages share one group surface, divider rows, and compact actions.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { KeyboardSection } from '../../../packages/core/src/shared/components/settings/KeyboardSection.jsx';
import {
    ROW,
    ROW_LAYOUT,
    SettingsActionRow,
    SettingsFieldRow,
    ToggleRow,
} from '../../../packages/core/src/shared/components/settings/_settingsPrimitives.jsx';
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
    it('draws one shared card surface and flattens its divider rows', () => {
        const css = readFileSync(join(SETTINGS_DIR, 'routes/Settings.module.css'), 'utf8');
        const surface = css.match(/\.settingsSurface\s*\{([^}]*)\}/)[1];
        expect(surface).toMatch(/composes:\s*card from/);
        expect(surface).toMatch(/--xc-settings-row-border:\s*0/);
        expect(surface).toMatch(/--xc-settings-row-divider:\s*var\(--xc-border\)/);

        const route = readFileSync(join(SETTINGS_DIR, 'routes/Settings.jsx'), 'utf8');
        expect(route).toMatch(/className=\{settingsStyles\.settingsSurface\}/);
        // No group keeps its own cards inside the Settings card (U16).
        expect(route).not.toMatch(/preserveNestedCards/);
    });

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
        // A group's title sits the section header gap above its content, and
        // the shortcut rows under it keep the Settings row gap.
        for (const section of container.querySelectorAll('section')) {
            expect(section.style.gap).toBe('var(--xc-section-header-gap)');
            expect(section.style.flexDirection).toBe('column');
        }
        const rowColumns = [...container.querySelectorAll('section > [data-xc-section-header] + div')]
            .filter((column) => column.querySelector('kbd'));
        expect(rowColumns.length).toBeGreaterThan(0);
        for (const column of rowColumns) {
            expect(column.style.gap).toBe('var(--xc-settings-row-gap)');
            expect(column.style.flexDirection).toBe('column');
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
        // The row is the shared padded card, including the divider treatment.
        expect(row).toHaveClass(cardStyles.card);
        expect(row.style.display).toBe(ROW_LAYOUT.display);
        expect(row.style.padding).toBe(ROW.padding);
        expect(row.style.border).toBe(ROW.border);
        expect(row.style.boxShadow).toBe(ROW.boxShadow);
        expect(getByRole('heading', { name: 'Back up recovery phrase' })).toBeTruthy();
        // The label never names the button, so its accessible name stays its own text.
        expect(getByRole('button', { name: 'Show…' })).toBeTruthy();
        const slot = getByRole('button').parentElement;
        expect(slot.style.marginInlineStart).toBe('auto');
        expect(slot.style.justifyContent).toBe('flex-end');
        expect(slot.style.flex).toBe('0 0 auto');
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

    it('keeps the Safety row actions at their compact size', () => {
        for (const file of ['PanicModeRow.jsx', 'DuressPassphraseRow.jsx']) {
            const src = readFileSync(join(SETTINGS_DIR, 'components/settings', file), 'utf8');
            expect(src, file).toMatch(/size="sm"[^>]*style=\{COMPACT_CONTROL\}/);
        }
    });
});

describe('Settings field rows', () => {
    it('shows contextual help beside field and toggle labels only when requested', () => {
        const onToggle = vi.fn();
        const { getByRole, getByText, queryByRole } = render(
            <>
                <SettingsFieldRow label="Theme" help="Choose how the wallet is colored.">
                    <select><option>System</option></select>
                </SettingsFieldRow>
                <ToggleRow
                    label="Protect previews"
                    help="Require confirmation before opening previews."
                    checked={false}
                    onChange={onToggle}
                />
                <SettingsFieldRow label="Format">
                    <select><option>Full</option></select>
                </SettingsFieldRow>
                <ToggleRow label="Offline mode" checked={false} onChange={() => {}} />
            </>,
        );

        const fieldHelp = getByRole('button', { name: 'About Theme' });
        const toggleHelp = getByRole('button', { name: 'About Protect previews' });
        expect(getByRole('combobox', { name: 'Theme' })).toBeTruthy();
        expect(getByRole('switch', { name: 'Protect previews' })).toBeTruthy();
        expect(queryByRole('button', { name: 'About Format' })).toBeNull();
        expect(queryByRole('button', { name: 'About Offline mode' })).toBeNull();

        fireEvent.click(toggleHelp);
        expect(onToggle).not.toHaveBeenCalled();
        fireEvent.focus(fieldHelp);
        expect(getByText('Choose how the wallet is colored.', { selector: '[role="tooltip"]' })).toBeVisible();
    });

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

    it('wraps a hint-less control one label gap under its label', () => {
        const { getByLabelText } = render(
            <>
                <SettingsFieldRow label="Strategy" embedded>
                    <select><option>Normal</option></select>
                </SettingsFieldRow>
                <SettingsFieldRow label="Theme">
                    <select><option>System</option></select>
                </SettingsFieldRow>
                <SettingsFieldRow label="Format" hint="How numbers show.">
                    <select><option>Full</option></select>
                </SettingsFieldRow>
            </>,
        );
        const rowOf = (label) => getByLabelText(label).parentElement.parentElement;
        expect(rowOf('Strategy').style.rowGap).toBe('var(--xc-label-gap)');
        expect(rowOf('Theme').style.rowGap).toBe('var(--xc-label-gap)');
        expect(rowOf('Format').style.rowGap).toBe('');
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
