// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: a network switch keeps the unlocked signer and Receive
// actionable. A shell that cannot preserve the signer must require unlock
// instead of mounting an unlocked Receive surface with unusable credentials.
//
// [P0] 2026-10-13: Generate after an active-network switch returns an address,
// and signer or password implementation errors never become user-visible copy.

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registry as registryLib } from '@xchain-wallet/core';
import { createDefaultSettings } from '../../packages/core/src/schemas/settings.js';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';
import { Receive } from '../../packages/core/src/shared/routes/Receive.jsx';
import { createBackgroundHost } from '../../packages/extension/src/background/createBackgroundHost.js';

vi.mock('qrcode', () => ({
    default: { toDataURL: vi.fn(async (value) => `data:image/png;base64,${value}`) },
}));

const WALLET_ID = 'wallet-1';
const ACCOUNT_ID = 'account-1';
const DESTINATION_CHAIN = 'bitcoin-testnet';
const RAW_CREDENTIAL_ERROR = 'receiveAddress: either `signer` or `password` is required';

function copy(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function collection(initial = []) {
    const records = new Map(initial.map((record) => [record.id, copy(record)]));
    return {
        get: async (id) => copy(records.get(id) ?? null),
        find: async (id) => copy(records.get(id) ?? null),
        put: async (record) => { records.set(record.id, copy(record)); },
        list: async () => Array.from(records.values(), copy),
        findBy: async (field, value) => Array.from(records.values())
            .filter((record) => record[field] === value)
            .map(copy),
    };
}

function hostFixture() {
    const settings = createDefaultSettings();
    const vault = {
        wallets: collection([{
            id: WALLET_ID,
            schemaVersion: 1,
            name: 'Network switch wallet',
            format: 'bip39',
            importedKeys: [],
        }]),
        accounts: collection([{
            id: ACCOUNT_ID,
            walletId: WALLET_ID,
            index: 0,
            name: 'Main account',
        }]),
        addresses: collection(),
        signers: collection(),
        settings: {
            get: async () => copy(settings),
            put: async (next) => { Object.assign(settings, copy(next)); },
        },
    };
    const signer = {
        id: 'software-signer-1',
        kind: 'software',
        getAddresses: vi.fn(async ({ chainId, accountIndex, change, startIndex }) => [{
            index: startIndex,
            address: `${chainId}-receive-${startIndex}`,
            publicKey: `02${String(startIndex + 1).padStart(64, '0')}`,
            path: `m/84'/1'/${accountIndex}'/${change}/${startIndex}`,
        }]),
        lock: vi.fn(),
    };
    const host = createBackgroundHost({
        vault,
        chainRegistry: registryLib.defaultRegistry(),
        sdkRegistry: { get: () => ({}) },
        signerPool: { get: () => signer, has: () => true },
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });

    const request = async (type, payload) => {
        const response = await host.handle({ type, request: payload });
        if (!response.ok) {
            throw Object.assign(new Error(response.error?.message), response.error);
        }
        return response.result;
    };
    const generateReceiveAddress = vi.fn((payload) => request('receive.getAddress', payload));
    return {
        signer,
        messaging: {
            setActiveNetwork: (payload) => request('settings.setActiveNetwork', payload),
            getSettings: () => request('settings.get'),
            getAddressesByChain: (walletId, accountId) => request('addresses.byChain', {
                walletId,
                accountId,
            }),
            getNewestAddress: (walletId, chainId, accountId) => request('addresses.newest', {
                walletId,
                chainId,
                accountId,
            }),
            generateReceiveAddress,
        },
    };
}

afterEach(() => cleanup());

describe('network switch signer regression', () => {
    it('[REGRESSION P0] generates from unlocked Receive after switching networks without exposing credential internals', async () => {
        const { messaging, signer } = hostFixture();

        const switched = await messaging.setActiveNetwork({
            walletId: WALLET_ID,
            network: 'testnet',
        });
        expect(switched.addresses.skipped).toBeNull();
        expect(switched.addresses.created).toContain(DESTINATION_CHAIN);

        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <Receive
                    walletId={WALLET_ID}
                    accountId={ACCOUNT_ID}
                    prefill={{ chainId: DESTINATION_CHAIN }}
                />
            </MessagingProvider>,
        );

        expect(await screen.findByDisplayValue(`${DESTINATION_CHAIN}-receive-0`))
            .toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Generate new address' }));

        expect(await screen.findByDisplayValue(`${DESTINATION_CHAIN}-receive-1`))
            .toBeInTheDocument();
        await waitFor(() => expect(messaging.generateReceiveAddress).toHaveBeenCalledOnce());
        expect(signer.getAddresses).toHaveBeenLastCalledWith(expect.objectContaining({
            chainId: DESTINATION_CHAIN,
            startIndex: 1,
        }));
        expect(screen.queryByRole('alert')).toBeNull();
        expect(document.body).not.toHaveTextContent(RAW_CREDENTIAL_ERROR);
        expect(document.body).not.toHaveTextContent(/signer|password is required/i);
    });
});
