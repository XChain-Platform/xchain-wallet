// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

let messagingStub;

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging: messagingStub }),
}));

const { NetworkSection } = await import(
    '../../../packages/core/src/shared/components/settings/NetworkSection.jsx'
);

beforeEach(() => {
    messagingStub = {
        getSettings: vi.fn().mockResolvedValue({
            schemaVersion: 2,
            activeNetwork: 'mainnet',
            developerMode: true,
        }),
        setActiveNetwork: vi.fn().mockResolvedValue({
            settings: { schemaVersion: 2, activeNetwork: 'testnet' },
            addresses: { created: ['bitcoin-testnet'], existing: [], failed: [] },
        }),
    };
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('NetworkSection switching', () => {
    it('confirms, persists through the address-seeding host route, then reloads', async () => {
        const reload = vi.fn();
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
        render(<NetworkSection activeWallet={{ id: 'wallet-1' }} reload={reload} />);

        const select = await screen.findByLabelText('Active network');
        fireEvent.change(select, { target: { value: 'testnet' } });

        expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/Mainnet data stays saved and hidden/));
        await waitFor(() => {
            expect(messagingStub.setActiveNetwork).toHaveBeenCalledWith({
                walletId: 'wallet-1',
                network: 'testnet',
            });
            expect(reload).toHaveBeenCalledOnce();
        });
    });

    it('does not persist or reload when confirmation is cancelled', async () => {
        const reload = vi.fn();
        vi.spyOn(window, 'confirm').mockReturnValue(false);
        render(<NetworkSection activeWallet={{ id: 'wallet-1' }} reload={reload} />);

        const select = await screen.findByLabelText('Active network');
        fireEvent.change(select, { target: { value: 'testnet' } });

        expect(messagingStub.setActiveNetwork).not.toHaveBeenCalled();
        expect(reload).not.toHaveBeenCalled();
        expect(select.value).toBe('mainnet');
    });

    it('restores the persisted network on a fresh mount', async () => {
        messagingStub.getSettings.mockResolvedValue({
            schemaVersion: 2,
            activeNetwork: 'regtest',
            developerMode: false,
        });
        render(<NetworkSection activeWallet={{ id: 'wallet-1' }} reload={() => {}} />);

        const select = await screen.findByLabelText('Active network');
        expect(select.value).toBe('regtest');
        expect(Array.from(select.options, (option) => option.value)).toEqual([
            'mainnet',
            'testnet',
            'regtest',
        ]);
    });
});
