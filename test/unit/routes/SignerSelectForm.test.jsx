// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SignerSelectForm } from '../../../packages/core/src/shared/routes/SignerSelectForm.jsx';

afterEach(cleanup);

const HARDWARE_SIGNER = {
    id: 'signer-ledger',
    kind: 'ledger',
    vendor: 'Ledger',
    model: 'Nano X',
    label: 'Travel Ledger',
    firmwareVersion: '2.2.4',
};

function mount({
    list = [],
    value = null,
    onChange = vi.fn(),
    walletMode = 'full',
} = {}) {
    const listSigners = vi.fn().mockResolvedValue(list);
    const getSettings = vi.fn().mockResolvedValue({ walletMode });
    const view = render(
        <MessagingProvider shell="web" messaging={{ listSigners, getSettings }}>
            <SignerSelectForm walletId="wallet-1" value={value} onChange={onChange} />
        </MessagingProvider>,
    );
    return { ...view, listSigners, onChange };
}

describe('SignerSelectForm optional callback safety', () => {
    it('settles an empty signer list when no change callback is provided', async () => {
        const listSigners = vi.fn().mockResolvedValue([]);
        const getSettings = vi.fn().mockResolvedValue({ walletMode: 'full' });

        render(
            <MessagingProvider shell="web" messaging={{ listSigners, getSettings }}>
                <SignerSelectForm walletId="wallet-1" value="stale-signer" />
            </MessagingProvider>,
        );

        await waitFor(() => expect(listSigners).toHaveBeenCalledWith('wallet-1'));
    });

    it('clears a selected hardware signer that is no longer paired', async () => {
        const onChange = vi.fn();
        mount({ list: [HARDWARE_SIGNER], value: 'missing-signer', onChange });

        await waitFor(() => expect(onChange).toHaveBeenCalledWith(null));
        expect(screen.getByRole('radio', { name: /Software wallet/i })).not.toBeChecked();
    });
});

describe('SignerSelectForm option guidance', () => {
    it('explains software and hardware behavior and selects the device id', async () => {
        const onChange = vi.fn();
        mount({ list: [HARDWARE_SIGNER], onChange });

        expect(await screen.findByText('Software wallet (this seed)')).toBeTruthy();
        expect(screen.getByText(/Uses this wallet's recovery phrase/i)).toBeTruthy();
        expect(screen.getByText('Travel Ledger')).toBeTruthy();
        expect(screen.getByText(/Hardware device: connect Ledger Nano X and approve there/i))
            .toHaveTextContent('firmware 2.2.4');
        expect(screen.getByText(/doesn't share recovery words or hardware secrets/i)).toBeTruthy();

        fireEvent.click(screen.getByRole('radio', { name: /Travel Ledger/i }));
        expect(onChange).toHaveBeenCalledWith('signer-ledger');
    });

    it('states that choosing a signer does not leave watch-only mode', async () => {
        mount({ list: [HARDWARE_SIGNER], walletMode: 'watcher' });

        expect(await screen.findByRole('note')).toHaveTextContent(
            /Watch-only mode remains active.*doesn't enable local transaction signing/i,
        );
    });
});
