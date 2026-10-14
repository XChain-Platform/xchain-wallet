// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { ShortcutHelp } from '../../../packages/core/src/shared/keyboard/ShortcutHelp.jsx';
import {
    attachExtensionCommandListener,
    EXTENSION_COMMANDS,
} from '../../../packages/extension/src/background/extensionCommands.js';

const manifest = JSON.parse(readFileSync(
    resolve('packages/extension/manifest.json'),
    'utf8',
));

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

function commandBus() {
    let listener;
    return {
        api: {
            onCommand: {
                addListener: vi.fn((next) => { listener = next; }),
                removeListener: vi.fn(),
            },
        },
        emit(command, tab) { listener(command, tab); },
    };
}

describe('extension manifest commands', () => {
    it('routes every declared command and ignores unknown command names', async () => {
        const bus = commandBus();
        const openWallet = vi.fn();
        const lockWallet = vi.fn();
        const detach = attachExtensionCommandListener({
            commandsApi: bus.api,
            openWallet,
            lockWallet,
        });

        const activeTab = { windowId: 7 };
        for (const command of Object.keys(manifest.commands)) bus.emit(command, activeTab);
        bus.emit('not-declared');
        await Promise.resolve();

        expect(Object.keys(manifest.commands).sort()).toEqual(
            Object.values(EXTENSION_COMMANDS).sort(),
        );
        expect(openWallet).toHaveBeenCalledWith(activeTab);
        expect(lockWallet).toHaveBeenCalledTimes(1);
        detach();
        expect(bus.api.onCommand.removeListener).toHaveBeenCalledTimes(1);
    });

    it('keeps defaults away from browser-owned shortcuts', () => {
        const browserOwned = new Set([
            'Ctrl+L', 'Ctrl+N', 'Ctrl+R', 'Ctrl+T', 'Ctrl+W',
            'Ctrl+Shift+N', 'Ctrl+Shift+T', 'Ctrl+Shift+W',
            'Command+L', 'Command+N', 'Command+R', 'Command+T', 'Command+W',
            'Command+Shift+N', 'Command+Shift+T', 'Command+Shift+W',
        ]);
        const defaults = Object.values(manifest.commands).map(
            (command) => command.suggested_key.default,
        );

        expect(new Set(defaults).size).toBe(defaults.length);
        for (const shortcut of defaults) expect(browserOwned.has(shortcut)).toBe(false);
    });

    it('lists current command shortcuts in the cheat sheet', async () => {
        const commands = Object.entries(manifest.commands).map(([name, command]) => ({
            name,
            description: command.description,
            shortcut: command.suggested_key.default,
        }));
        vi.stubGlobal('chrome', {
            commands: {
                getAll: vi.fn((callback) => callback(commands)),
            },
        });

        render(<ShortcutHelp open onClose={() => {}} />);

        await waitFor(() => expect(screen.getByText('Browser extension')).toBeTruthy());
        for (const command of commands) {
            expect(screen.getByText(command.description)).toBeTruthy();
            expect(screen.getByText(command.shortcut)).toBeTruthy();
        }
        expect(screen.getByText(/Manage browser extension shortcuts in your browser/)).toBeTruthy();
    });
});
