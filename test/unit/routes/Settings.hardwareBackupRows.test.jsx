// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Backup and Recovery on a hardware wallet: the keys stay on the device, so
// the rows that open the backup file, recovery phrase, test backup and the
// seed-keyed label pages never show (their pages would be blank or refused).
// The contacts rows stay. A software wallet keeps every row.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({
        settings: { privacy: {}, autolockMinutes: 5, notifications: {}, grace: { testSendThresholdSats: '0' } },
        loading: false,
        error: null,
        update: async () => {},
    }),
}));

const { Settings } = await import('../../../packages/core/src/shared/routes/Settings.jsx');
const { MessagingProvider } = await import('../../../packages/core/src/shared/MessagingProvider.jsx');

const messaging = {
    getSettings: () => new Promise(() => {}),
    listConnectedSites: () => Promise.resolve([]),
    listContacts: () => Promise.resolve([]),
};

const SEED_ROWS = ['Encrypted backup file', 'Recovery phrase', 'Test backup', 'Publish labels on-chain', 'Restore contacts'];

function openBackup(activeWallet) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Settings onBack={() => {}} activeWallet={activeWallet} />
        </MessagingProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Backup and Recovery/ }));
}

afterEach(() => cleanup());

describe('Backup and Recovery rows by wallet kind', () => {
    it('hides every seed row on a hardware wallet and keeps the contacts rows', () => {
        openBackup({ id: 'hw-1', name: 'My Trezor', format: 'hardware' });
        for (const title of SEED_ROWS) expect(screen.queryByText(title)).toBeNull();
        expect(screen.queryByText('Wallet backup')).toBeNull();
        expect(screen.getByText('Export contacts')).toBeTruthy();
        expect(screen.getByText('Import contacts')).toBeTruthy();
    });

    it('keeps every row on a software wallet', () => {
        openBackup({ id: 'w-1', name: 'Everyday', format: 'bip39' });
        for (const title of SEED_ROWS) expect(screen.getByText(title)).toBeTruthy();
    });
});
