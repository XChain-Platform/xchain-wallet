// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: the Advanced Actions SLEEP form labels the resume field in plain words,
// never the raw protocol name RESUME_BLOCK.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AdvancedActionsForm, fieldLabel } from '../../../packages/core/src/shared/routes/AdvancedActionsForm.jsx';

const BTC = 'bitcoin-mainnet';
const FROM = {
    id: 'bc-0',
    address: 'bc1qfieldlabeladdress00000000000000000000000',
    publicKey: '02'.padEnd(66, 'a'),
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};

afterEach(() => cleanup());

function sleepMessaging() {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [BTC]: [FROM] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [BTC]: FROM }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher', activeNetwork: 'mainnet' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        listActions: vi.fn().mockResolvedValue(['SLEEP']),
        getActionFormats: vi.fn().mockResolvedValue({ 0: 'VERSION|RESUME_BLOCK|MEMO' }),
        getActionFields: vi.fn().mockResolvedValue(['VERSION', 'RESUME_BLOCK', 'MEMO']),
    };
    return new Proxy(target, {
        get: (t, prop) => (prop in t ? t[prop] : () => Promise.resolve({ rows: [] })),
        has: (t, prop) => prop in t,
    });
}

describe('Advanced action field labels', () => {
    it('names RESUME_BLOCK in plain words and leaves other fields as listed', () => {
        expect(fieldLabel('RESUME_BLOCK')).toBe('Resume block');
        expect(fieldLabel('MEMO')).toBe('MEMO');
    });

    it('shows the SLEEP resume field as Resume block, not RESUME_BLOCK', async () => {
        render(
            <MessagingProvider shell="web" messaging={sleepMessaging()}>
                <AdvancedActionsForm walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );
        await waitFor(() => expect(document.querySelector('option[value="SLEEP"]')).toBeTruthy());
        const picker = document.querySelector('option[value="SLEEP"]').closest('select');
        fireEvent.change(picker, { target: { value: 'SLEEP' } });

        expect(await screen.findByLabelText('Resume block')).toBeInTheDocument();
        expect(screen.queryByLabelText('RESUME_BLOCK')).not.toBeInTheDocument();
        expect(screen.queryByText('RESUME_BLOCK')).not.toBeInTheDocument();
    });
});
