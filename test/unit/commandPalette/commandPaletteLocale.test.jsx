// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { CommandPalette } from '../../../packages/core/src/shared/commandPalette/CommandPalette.jsx';
import {
    buildCommands,
    categoryLabel,
    helpToCommands,
    parseFreeformCommands,
    settingsSectionsToCommands,
} from '../../../packages/core/src/shared/commandPalette/commandRegistry.js';
import { filterCommands } from '../../../packages/core/src/shared/commandPalette/fuzzyMatch.js';
import { registerLocale, setLocale } from '../../../packages/core/src/i18n/index.js';
import pseudoRtl from '../../../packages/core/src/i18n/locales/pseudo-rtl/index.js';

const wrap = (text) => `‏⟦${text}⟧`;
const byId = (list, id) => list.find((c) => c.id === id);

afterEach(async () => {
    cleanup();
    await setLocale('en');
    vi.restoreAllMocks();
});

async function useNonEnglish() {
    registerLocale('pseudo-rtl', pseudoRtl);
    await setLocale('pseudo-rtl');
}

describe('command palette titles follow the active locale', () => {
    it('builds every catalogue title and subtitle from the dictionary', async () => {
        const ctx = {
            navigate() {}, lock() {}, refresh() {}, scan() {}, switchWallet() {}, openHelp() {},
            hasBtcAddress: true, hasVmAddress: true, hasGovernanceAddress: true,
        };
        const english = buildCommands(ctx);
        await useNonEnglish();
        const commands = buildCommands(ctx);
        expect(commands.length).toBeGreaterThan(50);
        expect(commands.map((c) => c.id)).toEqual(english.map((c) => c.id));
        for (const [index, c] of commands.entries()) {
            expect(c.title, c.id).toBe(wrap(english[index].title));
            expect(c.subtitle, c.id).toBe(wrap(english[index].subtitle));
        }
    });

    it('translates settings, help and free-form rows', async () => {
        await useNonEnglish();
        const settings = settingsSectionsToCommands({ openSettings() {} });
        expect(byId(settings, 'settings-backup').title).toBe(wrap('Settings → ' + wrap('Backup')));
        const help = helpToCommands({ openSettings() {}, openHelp() {} });
        expect(byId(help, 'help-panic').title).toBe(wrap('What is panic mode?'));
        const [send] = parseFreeformCommands('send 5 abc', { composeSend() {} });
        expect(send.title).toBe(wrap('Send 5 ABC'));
        expect(categoryLabel('Navigate')).toBe(wrap('Navigate'));
    });

    it('renders translated titles and category headings in the open palette', async () => {
        await useNonEnglish();
        const commands = buildCommands({ navigate() {} });
        render(<CommandPalette open onClose={() => {}} commands={commands} />);
        expect(screen.getByText(wrap('Send'))).toBeTruthy();
        expect(screen.getByText(wrap('Navigate'))).toBeTruthy();
        expect(screen.queryByText('Send')).toBeNull();
    });

    it('still finds a command by its English keyword and by the translated title', async () => {
        await useNonEnglish();
        const commands = buildCommands({ navigate() {} });
        expect(filterCommands(commands, 'transfer').map((c) => c.id)).toContain('nav-send');
        expect(filterCommands(commands, 'Dispensers').map((c) => c.id)).toContain('nav-dispensers');
    });

    it('keeps English output in the English locale', () => {
        const commands = buildCommands({ navigate() {} });
        expect(byId(commands, 'nav-send').title).toBe('Send');
        expect(byId(commands, 'nav-send').keywords).toEqual(['pay', 'transfer', 'spend']);
        render(<CommandPalette open onClose={() => {}} commands={commands} />);
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'sen' } });
        expect(screen.getAllByText('Send').length).toBeGreaterThan(0);
    });
});
