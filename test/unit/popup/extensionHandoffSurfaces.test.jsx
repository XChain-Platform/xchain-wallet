// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ImportWallet } from '../../../packages/core/src/shared/routes/ImportWallet.jsx';
import { PairSignerForm } from '../../../packages/core/src/shared/routes/PairSignerForm.jsx';
import { Settings } from '../../../packages/core/src/shared/routes/Settings.jsx';

afterEach(() => {
    cleanup();
    Reflect.deleteProperty(navigator, 'hid');
});

describe('extension full-tab handoff surfaces', () => {
    it('offers import handoff and preserves the selected backup lane', () => {
        const onOpenInTab = vi.fn();
        render(
            <MessagingProvider shell="popup" messaging={{ importBackupFresh: vi.fn() }}>
                <ImportWallet
                    onBack={() => {}}
                    onImported={() => {}}
                    initialLane="backup"
                    onOpenInTab={onOpenInTab}
                />
            </MessagingProvider>,
        );

        expect(screen.getByRole('heading', { name: 'Restore backup' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Open in tab' }));
        expect(onOpenInTab).toHaveBeenCalledWith({ lane: 'backup' });
    });

    it('offers hardware pairing handoff before a device request starts', () => {
        Object.defineProperty(navigator, 'hid', { configurable: true, value: {} });
        const onOpenInTab = vi.fn();
        render(
            <MessagingProvider shell="popup" messaging={{ listSigners: vi.fn().mockResolvedValue([]) }}>
                <PairSignerForm
                    walletId="wallet-1"
                    pairTrezor={null}
                    pairLedger={vi.fn()}
                    onBack={() => {}}
                    onOpenInTab={onOpenInTab}
                />
            </MessagingProvider>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Open in tab' }));
        expect(onOpenInTab).toHaveBeenCalledOnce();
    });

    it('offers backup handoff on the backup settings subpage', () => {
        const onOpenBackupInTab = vi.fn();
        render(
            <MessagingProvider shell="popup" messaging={{
                getSettings: () => new Promise(() => {}),
                listConnectedSites: vi.fn().mockResolvedValue([]),
            }}>
                <Settings
                    onBack={() => {}}
                    activeWallet={{ id: 'wallet-1', name: 'Primary' }}
                    initialSubpageId="backup"
                    onOpenBackupInTab={onOpenBackupInTab}
                />
            </MessagingProvider>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Open in tab' }));
        expect(onOpenBackupInTab).toHaveBeenCalledOnce();
    });
});
