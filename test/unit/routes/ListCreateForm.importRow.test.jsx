// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import React from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListCreateForm } from '../../../packages/core/src/shared/routes/ListCreateForm.jsx';

const BTC = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'btc-source',
    address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    publicKey: '02ab',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};

afterEach(() => cleanup());

describe('ListCreateForm import actions', () => {
    it('sit directly under the address field in a plain full-width wrapping row', async () => {
        const base = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [BTC]: [ADDRESS] }),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
            isListTickCoinActive: vi.fn().mockResolvedValue(false),
            getActionFormats: vi.fn().mockResolvedValue(null),
        };
        const messaging = new Proxy(base, {
            get(target, prop) {
                if (prop in target) return target[prop];
                if (typeof prop !== 'string') return undefined;
                const stub = vi.fn().mockResolvedValue(null);
                target[prop] = stub;
                return stub;
            },
        });
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <ListCreateForm walletId="wallet-1" chainId={BTC} initialType="2" onBack={() => {}} />
            </MessagingProvider>,
        );
        await screen.findByLabelText('From');
        await waitFor(() => expect(base.getActionFormats).toHaveBeenCalled());
        const upload = await screen.findByRole('button', { name: 'Upload CSV' });
        const contacts = screen.getByRole('button', { name: 'Add from contacts' });
        expect(upload.parentElement).toBe(contacts.parentElement);
        expect(upload.parentElement.className).toMatch(/importActions/);
        expect(upload.parentElement.className).not.toMatch(/fromLine/);
        expect(upload.parentElement.previousElementSibling).toContainElement(screen.getByLabelText('Addresses'));

        const css = readFileSync('packages/core/src/shared/routes/IssueTokenForm.module.css', 'utf8');
        expect(css).toMatch(/\.importActions\s*{[^}]*display:\s*flex[^}]*flex-wrap:\s*wrap/s);
        expect(css).toMatch(/\.importActions\s*>\s*button\s*{[^}]*flex:\s*1 1 10rem/s);
    });
});
