// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Backup section opened directly (the command palette's Backup entry and
// the Contacts "Open Backup" action both land on Settings with the 'backup'
// subpage): on a hardware wallet it offers no export, phrase, test, publish or
// restore action, only a line saying the device keeps its own keys and seed.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({
        settings: { privacy: {}, autolockMinutes: 5, notifications: {}, grace: { testSendThresholdSats: '0' } },
        loading: false,
        error: null,
        update: async () => {},
    }),
}));

const { Settings } = await import('../../../packages/core/src/shared/routes/Settings.jsx');
const { BackupSection } = await import('../../../packages/core/src/shared/components/settings/BackupSection.jsx');
const { MessagingProvider } = await import('../../../packages/core/src/shared/MessagingProvider.jsx');
const { settingsSectionsToCommands } = await import('../../../packages/core/src/shared/commandPalette/commandRegistry.js');

const messaging = {
    getSettings: () => new Promise(() => {}),
    listConnectedSites: () => Promise.resolve([]),
    listContacts: () => Promise.resolve([]),
    labelSyncStatusRequest: () => Promise.resolve({ due: true, changeCount: 2 }),
};

const HW = { id: 'hw-1', name: 'My Trezor', format: 'hardware' };
const SOFT = { id: 'w-1', name: 'Everyday', format: 'bip39' };
const ACTION_TEXT = [/Encrypted backup/i, /Recovery phrase/i, /Test backup|Test restore/i, /Publish labels/i, /Check network|Check chain/i];

afterEach(() => cleanup());

function openDirect(wallet) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Settings onBack={() => {}} activeWallet={wallet} initialSubpageId="backup" />
        </MessagingProvider>,
    );
}

describe('Backup opened directly on a hardware wallet', () => {
    it('palette entry: the backup subpage shows only the hardware line', async () => {
        const opened = [];
        const cmds = settingsSectionsToCommands({ openSettings: (id) => opened.push(id) });
        cmds.find((c) => c.id === 'settings-backup').run();
        expect(opened).toEqual(['backup']);
        openDirect(HW);
        expect(await screen.findByTestId('backup-hardware-note')).toBeTruthy();
        for (const re of ACTION_TEXT) expect(screen.queryByText(re)).toBeNull();
        expect(screen.queryByRole('button', { name: /publish|check|export|show|test/i })).toBeNull();
    });

    it('Contacts "Open Backup": the same subpage hides the refused actions', async () => {
        openDirect(HW);
        expect((await screen.findByTestId('backup-hardware-note')).textContent).toMatch(/own keys and its own recovery seed/);
        expect(screen.queryByText(/labels changed since/i)).toBeNull();
    });

    it('the section itself hides every part on a hardware wallet', () => {
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <BackupSection activeWallet={HW} />
            </MessagingProvider>,
        );
        expect(screen.getByTestId('backup-hardware-note')).toBeTruthy();
        for (const re of ACTION_TEXT) expect(screen.queryByText(re)).toBeNull();
    });

    it('a software wallet keeps its actions and shows no hardware line', () => {
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <BackupSection activeWallet={SOFT} />
            </MessagingProvider>,
        );
        expect(screen.queryByTestId('backup-hardware-note')).toBeNull();
        expect(screen.getByText(/Publish labels/i)).toBeTruthy();
    });
});
