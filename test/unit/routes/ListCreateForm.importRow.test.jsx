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
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

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
    it('put the standard file field under the address box and contacts in a wrapping row below', async () => {
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
        // The file is the standard file field right under the Addresses box,
        // with no separate Upload CSV button.
        const fileField = (await screen.findByLabelText('Addresses file (CSV or TXT)')).closest('[data-file-field]');
        expect(fileField).not.toBeNull();
        expect(fileField.previousElementSibling).toContainElement(screen.getByLabelText('Addresses'));
        expect(screen.queryByRole('button', { name: 'Upload CSV' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Choose a file' })).toBeInTheDocument();

        // Add from contacts keeps its own wrapping row under the file field.
        const contacts = screen.getByRole('button', { name: /^Add from Contacts$/ });
        expect(contacts.parentElement.className).toMatch(/importActions/);
        expect(contacts.parentElement.className).not.toMatch(/fromLine/);
        expect(contacts.parentElement.previousElementSibling).toBe(fileField);

        const css = readFileSync('packages/core/src/shared/routes/IssueTokenForm.module.css', 'utf8');
        expect(css).toMatch(/\.importActions\s*{[^}]*display:\s*flex[^}]*flex-wrap:\s*wrap/s);
        expect(css).toMatch(/\.importActions\s*>\s*button\s*{[^}]*flex:\s*1 1 10rem/s);
    });

    it('adds a picked file under the typed addresses and takes back only those on Remove', async () => {
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
        const box = await screen.findByLabelText('Addresses');
        fireEvent.change(box, { target: { value: 'typed-address' } });

        fireEvent.change(screen.getByLabelText('Upload addresses file'), {
            target: { files: [new File(['file-one\nfile-two'], 'members.csv', { type: 'text/csv' })] },
        });
        const field = screen.getByLabelText('Addresses file (CSV or TXT)');
        await waitFor(() => expect(field).toHaveValue('members.csv'));
        expect(box).toHaveValue('typed-address\nfile-one\nfile-two');

        fireEvent.click(screen.getByRole('button', { name: 'Remove file' }));
        expect(box).toHaveValue('typed-address');
        expect(field).toHaveValue('');
    });
});
