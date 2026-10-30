// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: Preview on an untouched action form names the field to fill and
// never reaches the encoder.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AdvancedActionsForm } from '../../../packages/core/src/shared/routes/AdvancedActionsForm.jsx';

const BTC = 'bitcoin-mainnet';
const FROM = {
    id: 'bc-0',
    address: 'bc1qblankformaddress00000000000000000000000',
    publicKey: '02'.padEnd(66, 'a'),
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};

afterEach(() => cleanup());

describe('AdvancedActionsForm blank form', () => {
    it('refuses Preview with a field-level message and does not call the encoder', async () => {
        const composeForConfirm = vi.fn().mockResolvedValue({});
        const target = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [BTC]: [FROM] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [BTC]: FROM }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', activeNetwork: 'mainnet' }),
            signerReady: vi.fn().mockResolvedValue({ ready: false }),
            listActions: vi.fn().mockResolvedValue(['BROADCAST']),
            getActionFormats: vi.fn().mockResolvedValue({ 0: 'VERSION|MESSAGE|VALUE' }),
            getActionFields: vi.fn().mockResolvedValue(['VERSION', 'MESSAGE', 'VALUE']),
            composeForConfirm,
        };
        const messaging = new Proxy(target, {
            get: (t, prop) => (prop in t ? t[prop] : () => Promise.resolve({ rows: [] })),
            has: (t, prop) => prop in t,
        });
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <AdvancedActionsForm walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );
        await waitFor(() => expect(document.querySelector('option[value="BROADCAST"]')).toBeTruthy());
        const picker = document.querySelector('option[value="BROADCAST"]').closest('select');
        fireEvent.change(picker, { target: { value: 'BROADCAST' } });
        await screen.findByLabelText('MESSAGE');
        fireEvent.click(screen.getByRole('button', { name: /^(Preview|Sign action)$/ }));

        expect((await screen.findAllByText('Enter a value for MESSAGE.')).length).toBeGreaterThan(0);
        expect(screen.getByLabelText('MESSAGE')).toHaveAttribute('aria-invalid', 'true');
        expect(composeForConfirm).not.toHaveBeenCalled();
        expect(screen.queryByRole('heading', { name: /Review/ })).toBeNull();
    });
});
