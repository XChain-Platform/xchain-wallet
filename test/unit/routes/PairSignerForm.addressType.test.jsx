// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The address type the connect flow records is the type of the address the
// device derived, on every chain and vendor.
//
// It used to ask each device for its default (Litecoin: legacy 44', an
// L... address) while recording the chain's default type (p2wpkh), so a
// Litecoin hardware account was labelled native segwit and held a legacy
// address, on mainnet too. The form now asks for the type it records, the
// same default the software signer and createAccount use.
//
// The signers are the real TrezorSigner and LedgerSigner over seeded
// stand-in devices that encode with the vendors' own coin parameters, and the
// type is read back from each address's encoding alone (bech32 HRP and
// witness program, or base58 version byte), not from the path.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PairSignerForm } from '../../../packages/core/src/shared/routes/PairSignerForm.jsx';
import { hardwareNetworkSupport } from '../../../packages/core/src/flows/hardwareWallet.js';
import { ledgerAppNameFor } from '../../../packages/core/src/signers/ledgerIdentity.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { makeLedgerFactory } from '../../../packages/core/src/signerFactories/ledger.js';
import { TrezorSigner } from '../../../packages/signers-trezor/src/TrezorSigner.js';
import {
    SEED_A, addressTypeOfEncoding, seededLedger, seededTrezorConnect,
} from '../../helpers/hwSeedDevice.js';

const REGISTRY = defaultRegistry();

function api() {
    return {
        getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'mainnet', fiatCurrency: 'USD' }),
        hardwareBalances: vi.fn(async ({ items }) => items.map((item) => ({ ...item, balance: '0', fiat: 0 }))),
        addHardwareWallet: vi.fn(async ({ name }) => ({
            wallet: { id: 'wallet-hw-1', name }, signer: { id: 'signer-hw-1' }, accounts: [], addresses: [],
        })),
    };
}

/** A real vendor signer over a seeded device, with getAddresses watched. */
function deviceFor(vendor) {
    if (vendor === 'trezor') {
        const signer = new TrezorSigner({
            id: 'trezor-t', displayName: 'Trezor', model: 'T3T1', deviceIdentifier: 'trezor-dev', connect: seededTrezorConnect(SEED_A),
        });
        const spy = vi.spyOn(signer, 'getAddresses');
        const pair = vi.fn(async () => ({
            signer,
            pairingInfo: { vendor: 'trezor', model: 'T3T1', deviceIdentifier: 'trezor-dev', firmwareVersion: '2.8.1' },
        }));
        return { pair, spy: () => spy, device: null };
    }
    // The Ledger opens in its Bitcoin app; the test opens each other chain's
    // app when the form asks for it, then taps that row's Try again, which
    // reopens the Ledger in that app. Every opened signer's calls are kept.
    const dev = seededLedger(SEED_A, { openApp: 'Bitcoin' });
    const factory = makeLedgerFactory({ getTransport: async () => dev.transport, getAppClass: async () => dev.Btc });
    const calls = [];
    const pair = vi.fn(async () => {
        const out = await factory();
        const derive = out.signer.getAddresses.bind(out.signer);
        out.signer.getAddresses = async (params) => {
            calls.push([params]);
            return derive(params);
        };
        return out;
    });
    return { pair, spy: () => ({ mock: { calls } }), device: dev.device };
}

/** Open the app each waiting network asks for, then tap its Try again. */
async function openEachWaitingApp(device) {
    for (;;) {
        const row = document.querySelector('li[data-wait="app"]');
        if (!row) return;
        device.openApp = ledgerAppNameFor(row.getAttribute('data-chain-id'));
        await act(async () => {
            fireEvent.click(within(row).getByRole('button', { name: /^Try Again on / }));
        });
        await waitFor(() => expect(document.querySelector('li[data-wait="reading"]')).toBeNull());
    }
}

/** The chains of a network the form offers this vendor, from the same tables it reads. */
function supportedOn(vendor, network) {
    return ['bitcoin', 'litecoin', 'dogecoin']
        .flatMap((family) => ['mainnet', 'testnet', 'regtest'].map((kind) => `${family}-${kind}`))
        .filter((id) => REGISTRY.get(id).networkKind === network)
        .filter((id) => hardwareNetworkSupport(vendor, id).supported)
        .sort();
}

beforeEach(() => {
    Object.defineProperty(navigator, 'hid', { configurable: true, value: {} });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, 'hid');
});

async function connectAndSave(vendor, network) {
    const messaging = api();
    const { pair, spy, device } = deviceFor(vendor);
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <PairSignerForm
                mode="add"
                activeNetwork={network}
                pairTrezor={vendor === 'trezor' ? pair : null}
                pairLedger={vendor === 'ledger' ? pair : null}
                onBack={vi.fn()}
                onCreated={vi.fn()}
            />
        </MessagingProvider>,
    );
    await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: vendor === 'trezor' ? /Trezor/ : /Ledger/ }));
    });
    await act(async () => {
        fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    });
    const expected = supportedOn(vendor, network);
    if (device) {
        // The open app's chains are read first; every other chain waits for its app.
        await waitFor(() => expect(document.querySelector('li[data-wait="app"]')).not.toBeNull());
        await openEachWaitingApp(device);
    }
    await waitFor(() => expect(spy()?.mock.calls.length).toBe(expected.length));
    const add = screen.getByRole('button', { name: 'Add Wallet' });
    await waitFor(() => expect(add).toBeEnabled());
    await act(async () => {
        fireEvent.click(add);
    });
    expect(messaging.addHardwareWallet).toHaveBeenCalledOnce();
    return { accounts: messaging.addHardwareWallet.mock.calls[0][0].accounts, calls: spy().mock.calls, expected };
}

describe('the connect flow records the type of the address the device derived', () => {
    for (const vendor of ['trezor', 'ledger']) {
        for (const network of ['mainnet', 'testnet', 'regtest']) {
            it(`${vendor} ${network}: every account's recorded type is its address's encoding and the chain's default`, async () => {
                const { accounts, calls, expected } = await connectAndSave(vendor, network);
                expect(expected.length).toBeGreaterThan(0);
                expect(accounts.map((a) => a.chainId).sort()).toEqual(expected);
                for (const account of accounts) {
                    const { defaultAddressType } = REGISTRY.get(account.chainId);
                    const asked = calls.find(([params]) => params.chainId === account.chainId)[0];
                    expect([account.chainId, asked.addressType]).toEqual([account.chainId, account.addressType]);
                    expect([account.chainId, account.addressType]).toEqual([account.chainId, defaultAddressType]);
                    expect([account.chainId, account.address, addressTypeOfEncoding(account.address, account.chainId)])
                        .toEqual([account.chainId, account.address, account.addressType]);
                }
            });
        }
    }

    for (const vendor of ['trezor', 'ledger']) {
        it(`${vendor}: Litecoin mainnet is native segwit at 84', as the software signer derives it`, async () => {
            const { accounts } = await connectAndSave(vendor, 'mainnet');
            const litecoin = accounts.find((a) => a.chainId === 'litecoin-mainnet');
            expect(litecoin.addressType).toBe('p2wpkh');
            expect(litecoin.derivationPath).toBe("m/84'/2'/0'/0/0");
            expect(litecoin.address.startsWith('ltc1q')).toBe(true);
        });
    }
});
