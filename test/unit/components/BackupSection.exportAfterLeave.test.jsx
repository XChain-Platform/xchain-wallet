// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// An export still encrypting when the screen goes away (the wallet locks, the
// user navigates) saves no file once its reply lands.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BackupSection } from '../../../packages/core/src/shared/components/settings/BackupSection.jsx';

vi.mock('qrcode', () => ({
    default: { toDataURL: vi.fn(async () => 'data:image/png;base64,cXI=') },
}));

const CONTENT = JSON.stringify({
    magic: 'XCHAIN-WALLET-BACKUP',
    formatVersion: 1,
    createdAt: '2026-10-13T18:00:00.000Z',
    walletName: 'Late Vault',
    encryption: {
        algorithm: 'aes-256-gcm',
        kdf: { algorithm: 'argon2id', salt: 'AAAAAAAAAAAAAAAAAAAAAA==', iterations: 3, memory: 65536, parallelism: 1 },
        iv: 'AAAAAAAAAAAAAAAA',
        tag: 'AAAAAAAAAAAAAAAAAAAAAA==',
    },
    payload: 'encrypted-payload',
}, null, 2);

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('BackupSection export that outlives its screen', () => {
    it('does not download a file after the screen unmounts', async () => {
        const clicks = [];
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
            clicks.push(this.download);
        });
        const createObjectURL = vi.fn(() => 'blob:late');
        URL.createObjectURL = createObjectURL;
        URL.revokeObjectURL = vi.fn();

        let finish;
        const messaging = { exportBackupFile: vi.fn(() => new Promise((resolve) => { finish = resolve; })) };
        const view = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <BackupSection activeWallet={{ id: 'wallet-1', name: 'Late Vault' }} />
            </MessagingProvider>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Export…' }));
        fireEvent.change(screen.getByLabelText('Backup password'), { target: { value: 'backup-secret' } });
        fireEvent.change(screen.getByLabelText('Confirm backup password'), { target: { value: 'backup-secret' } });
        fireEvent.click(screen.getByRole('button', { name: 'Export' }));
        expect(messaging.exportBackupFile).toHaveBeenCalledTimes(1);

        view.unmount();
        await act(async () => { finish({ fileContent: CONTENT }); });

        expect(clicks).toEqual([]);
        expect(createObjectURL).not.toHaveBeenCalled();
    });
});
