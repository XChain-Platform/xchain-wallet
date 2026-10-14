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
