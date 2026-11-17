// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A hardware wallet has no seed: the backup file, recovery phrase and test
// restore rows never show for it (their host calls refuse with HW_NO_SEED),
// and Home's backup reminder skips it. A software wallet keeps all of them.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BackupSection } from '../../../packages/core/src/shared/components/settings/BackupSection.jsx';
import { BackupReminderCard } from '../../../packages/core/src/shared/components/BackupReminderCard.jsx';

vi.mock('qrcode', () => ({
    default: { toDataURL: vi.fn(async () => 'data:image/png;base64,cXI=') },
}));

afterEach(cleanup);

function mountBackup(wallet, only = null) {
    return render(
        <MessagingProvider shell="web" messaging={{}}>
            <BackupSection activeWallet={wallet} only={only} />
        </MessagingProvider>,
    );
}

describe('Backup rows on a hardware wallet', () => {
    it('hides export, recovery phrase and test restore', () => {
        mountBackup({ id: 'hw-1', name: 'My Trezor', format: 'hardware' });
        expect(screen.queryByRole('button', { name: 'Export…' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Show…' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Test…' })).toBeNull();
    });

    it('renders no phrase prompt on the direct phrase page', () => {
        mountBackup({ id: 'hw-1', name: 'My Trezor', format: 'hardware' }, 'phrase');
        expect(screen.queryByLabelText('Wallet password')).toBeNull();
    });

    it('keeps all three on a software wallet', () => {
        mountBackup({ id: 'w-1', name: 'Everyday', format: 'bip39' });
        expect(screen.getByRole('button', { name: 'Export…' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Show…' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Test…' })).toBeInTheDocument();
    });
});

describe('Backup reminder on a hardware wallet', () => {
    it('never shows, even with funds and no backup', () => {
        const { container } = render(
            <BackupReminderCard walletId="hw-reminder" hasFunds walletFormat="hardware" onAction={() => {}} />,
        );
        expect(container).toBeEmptyDOMElement();
    });
});
