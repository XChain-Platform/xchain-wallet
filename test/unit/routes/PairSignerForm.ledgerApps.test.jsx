// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Step 3 (Accounts) on a Ledger, which runs one app per coin and answers
// only its own coin from whichever app is open. The step reads each network
// through the app that is open, keeps what it read, and leaves every other
// network waiting in its row ("Open the Litecoin app on your Ledger") with a
// Try again that reopens the Ledger in the app open now. A waiting network is
// neither a check nor an X. Add Wallet saves the networks read so far.
//
// The device is the real Ledger factory and LedgerSigner over a seeded
// stand-in whose apps refuse every other coin type, as a real Ledger does.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PairSignerForm } from '../../../packages/core/src/shared/routes/PairSignerForm.jsx';
import { makeLedgerFactory } from '../../../packages/core/src/signerFactories/ledger.js';
import { ledgerIdentitiesFromAccounts } from '../../../packages/core/src/signers/ledgerIdentity.js';
import { SEED_A, SEED_B, seededLedger } from '../../helpers/hwSeedDevice.js';

function api() {
    return {
        getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'mainnet', fiatCurrency: 'USD' }),
        hardwareBalances: vi.fn(async ({ items }) => items.map((item) => ({ ...item, balance: '1', fiat: 10 }))),
        addHardwareWallet: vi.fn(async ({ name, accounts }) => ({
            wallet: { id: 'wallet-hw-1', name },
            signer: {
                id: 'signer-hw-1',
                vendor: 'ledger',
                model: 'nanoX',
                deviceIdentifier: 'saved-id',
                identities: ledgerIdentitiesFromAccounts(accounts),
            },
            accounts: [],
            addresses: [],
        })),
    };
}

/**
 * A Ledger (seed A) plugged in with its Bitcoin app open. `plug` swaps in
 * another device; `open` switches the app the plugged device has open.
 */
function ledgerRig() {
    const devices = { A: seededLedger(SEED_A, { openApp: 'Bitcoin' }), B: seededLedger(SEED_B, { openApp: 'Bitcoin' }) };
    let plugged = devices.A;
    const factory = makeLedgerFactory({
        getTransport: async () => plugged.transport,
        getAppClass: async () => plugged.Btc,
    });
    const reads = [];
    const pair = vi.fn(async () => {
        const out = await factory();
        const derive = out.signer.getAddresses.bind(out.signer);
        out.signer.getAddresses = async (params) => {
            reads.push(params);
            return derive(params);
        };
        return out;
    });
    return {
        pair,
        reads,
        open(app) { plugged.device.openApp = app; },
        plug(name, app) {
            plugged = devices[name];
            plugged.device.openApp = app;
        },
    };
}

async function reachAccounts({ messaging = api(), rig = ledgerRig(), ...props } = {}) {
    const handlers = { onBack: vi.fn(), onCreated: vi.fn(), onSignerPaired: vi.fn(), ...props };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <PairSignerForm mode="add" activeNetwork="mainnet" pairTrezor={null} pairLedger={rig.pair} {...handlers} />
        </MessagingProvider>,
    );
    await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Ledger/ }));
    });
    await act(async () => {
        fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    });
    await waitFor(() => expect(networkRow('litecoin-mainnet').getAttribute('data-wait')).toBe('app'));
    return { messaging, rig, ...handlers };
}

function networkRow(chainId) {
    const list = screen.getByRole('list', { name: 'Networks' });
    return list.querySelector(`li[data-chain-id="${chainId}"]`);
}

// A network read through the open app is its on switch (G131); a waiting one
// has none, only its Try again row.
function switchOf(row) {
    return row.querySelector('[role="switch"]');
}

async function tryAgainOn(chainId) {
    const row = networkRow(chainId);
    await act(async () => {
        fireEvent.click(within(row).getByRole('button', { name: /^Try Again on / }));
    });
    await waitFor(() => expect(networkRow(chainId).getAttribute('data-wait')).not.toBe('reading'));
}

beforeEach(() => {
    Object.defineProperty(navigator, 'hid', { configurable: true, value: {} });
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    Reflect.deleteProperty(navigator, 'hid');
});

describe('Ledger accounts step: each network through the app that is open', () => {
    it('reads Bitcoin from the Bitcoin app and leaves Litecoin and Dogecoin waiting, without asking the device for them', async () => {
        const { rig } = await reachAccounts();

        expect(rig.reads.map((r) => r.chainId)).toEqual(['bitcoin-mainnet']);
        expect(switchOf(networkRow('bitcoin-mainnet'))).toBeChecked();
        for (const [chainId, app] of [['litecoin-mainnet', 'Litecoin'], ['dogecoin-mainnet', 'Dogecoin']]) {
            const row = networkRow(chainId);
            expect(row).toHaveTextContent(`Open the ${app} app on your Ledger`);
            // A waiting network is one tappable list row, with no inline status action.
            expect(switchOf(row)).toBeNull();
            expect(within(row).getByRole('button', { name: `Try Again on ${app}` })).toBeTruthy();
        }
    });

    it('Try again with the Litecoin app open reads Litecoin and keeps Bitcoin', async () => {
        const { rig } = await reachAccounts();
        rig.open('Litecoin');
        await tryAgainOn('litecoin-mainnet');

        expect(rig.pair).toHaveBeenCalledTimes(2);
        expect(rig.reads.map((r) => r.chainId)).toEqual(['bitcoin-mainnet', 'litecoin-mainnet']);
        expect(networkRow('litecoin-mainnet').hasAttribute('data-wait')).toBe(false);
        expect(switchOf(networkRow('litecoin-mainnet'))).toBeChecked();
        expect(switchOf(networkRow('bitcoin-mainnet'))).toBeChecked();
        expect(networkRow('dogecoin-mainnet')).toHaveAttribute('data-wait', 'app');

        fireEvent.click(screen.getByRole('tab', { name: /Accounts/ }));
        const accounts = screen.getByRole('list', { name: 'Accounts found' });
        // One account, its Bitcoin and Litecoin addresses read so far.
        const account = accounts.querySelector('li[data-account-index="0"]');
        expect(account).toHaveTextContent('Account 1');
        expect(account).toHaveTextContent('2 addresses on 2 networks');
        const doge = accounts.querySelector('li[data-chain-id="dogecoin-mainnet"]');
        expect(doge).toHaveAttribute('data-wait', 'app');
        expect(doge).toHaveTextContent('Open the Dogecoin app on your Ledger');
        expect(within(doge).getByRole('button', { name: 'Try Again on Dogecoin' })).toBeEnabled();
    });

    it('Try again while the same app is still open leaves the network waiting', async () => {
        const { rig } = await reachAccounts();
        await tryAgainOn('litecoin-mainnet');

        expect(rig.pair).toHaveBeenCalledTimes(2);
        expect(rig.reads.map((r) => r.chainId)).toEqual(['bitcoin-mainnet']);
        expect(networkRow('litecoin-mainnet')).toHaveAttribute('data-wait', 'app');
        expect(networkRow('litecoin-mainnet')).toHaveTextContent('Open the Litecoin app on your Ledger');
    });

    it('a network read late is read at every account number asked for so far', async () => {
        const { rig } = await reachAccounts();
        fireEvent.click(screen.getByRole('tab', { name: /Accounts/ }));
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /^Add Account/ }));
        });
        await waitFor(() => expect(rig.reads).toHaveLength(2));
        expect(rig.reads.map((r) => [r.chainId, r.accountIndex])).toEqual([
            ['bitcoin-mainnet', 0], ['bitcoin-mainnet', 1],
        ]);

        rig.open('Dogecoin');
        const doge = screen.getByRole('list', { name: 'Accounts found' }).querySelector('li[data-chain-id="dogecoin-mainnet"]');
        await act(async () => {
            fireEvent.click(within(doge).getByRole('button', { name: 'Try Again on Dogecoin' }));
        });
        await waitFor(() => expect(rig.reads).toHaveLength(4));
        expect(rig.reads.slice(2).map((r) => [r.chainId, r.accountIndex])).toEqual([
            ['dogecoin-mainnet', 0], ['dogecoin-mainnet', 1],
        ]);
    });

    it('refuses a different Ledger reopened in the same app and keeps the network waiting', async () => {
        const { rig } = await reachAccounts();
        rig.plug('B', 'Bitcoin');
        await tryAgainOn('litecoin-mainnet');

        expect(await screen.findByText(/This is a different Ledger\./)).toBeInTheDocument();
        expect(networkRow('litecoin-mainnet')).toHaveAttribute('data-wait', 'app');
        expect(rig.reads.map((r) => r.chainId)).toEqual(['bitcoin-mainnet']);
    });

    it('Add Wallet saves the networks read so far and hands the bridge the saved record with its identities', async () => {
        const { rig, messaging, onSignerPaired, onCreated } = await reachAccounts();
        rig.open('Litecoin');
        await tryAgainOn('litecoin-mainnet');

        const add = screen.getByRole('button', { name: 'Add Wallet' });
        await waitFor(() => expect(add).toBeEnabled());
        await act(async () => {
            fireEvent.click(add);
        });

        const sent = messaging.addHardwareWallet.mock.calls[0][0];
        expect(sent.accounts.map((a) => a.chainId)).toEqual(['bitcoin-mainnet', 'litecoin-mainnet']);
        // The device saved is the first pairing's (Bitcoin app), not the reopened one.
        expect(sent.device.deviceIdentifier).toBe((await rig.pair.mock.results[0].value).pairingInfo.deviceIdentifier);
        expect(onCreated).toHaveBeenCalledWith('wallet-hw-1');

        const [signerId, handed] = onSignerPaired.mock.calls[0];
        expect(signerId).toBe('signer-hw-1');
        expect(handed.isHardwareSessionSigner).toBe(true);
        expect(handed.isLive()).toBe(true);
        expect(Object.keys(handed.record.identities).sort()).toEqual(['bitcoin-mainnet', 'litecoin-mainnet']);
    });

    // G131: an account can be switched off, so a save may hold no Account 1.
    // The Ledger's identity is then taken from the lowest account saved.
    it('saves only Account 2 with Account 1 switched off, and still records the Ledger identity', async () => {
        const { rig, messaging, onSignerPaired } = await reachAccounts();
        fireEvent.click(screen.getByRole('tab', { name: /Accounts/ }));
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /^Add Account/ }));
        });
        await waitFor(() => expect(rig.reads).toHaveLength(2));
        fireEvent.click(screen.getByRole('switch', { name: 'Account 1' }));

        const add = screen.getByRole('button', { name: 'Add Wallet' });
        await waitFor(() => expect(add).toBeEnabled());
        await act(async () => {
            fireEvent.click(add);
        });
        const sent = messaging.addHardwareWallet.mock.calls[0][0];
        expect(sent.accounts.map((a) => [a.chainId, a.accountIndex])).toEqual([['bitcoin-mainnet', 1]]);
        const [, handed] = onSignerPaired.mock.calls[0];
        expect(handed.record.identities['bitcoin-mainnet']).toEqual(expect.objectContaining({
            path: sent.accounts[0].derivationPath,
            fingerprint: expect.any(String),
        }));
    });
});

describe('Ledger accounts step: a refusal the open-app list did not predict', () => {
    // A factory that does not say which chains its app serves: the step asks
    // for every network and sorts the refusals.
    function mockLedger(getAddresses) {
        const signer = { vendor: 'ledger', kind: 'ledger', getAddresses: vi.fn(getAddresses) };
        return vi.fn(async () => ({
            signer,
            pairingInfo: { vendor: 'ledger', model: 'nanoX', deviceIdentifier: 'dev-1', firmwareVersion: '2.2.1' },
        }));
    }

    async function reach(pair) {
        render(
            <MessagingProvider shell="web" messaging={api()}>
                <PairSignerForm mode="add" activeNetwork="mainnet" pairTrezor={null} pairLedger={pair} onBack={vi.fn()} onCreated={vi.fn()} />
            </MessagingProvider>,
        );
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Ledger/ }));
        });
        await act(async () => {
            fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
        });
    }

    const address = (chainId) => [{ address: `${chainId}-addr`, publicKey: `02${'11'.repeat(32)}`, path: "m/84'/0'/0'/0/0" }];

    it('a wrong-app refusal waits for that app and keeps the rest', async () => {
        const wrongApp = Object.assign(new Error('The wrong app is open on your Ledger. Open the app for this network, then try again.'), { code: 'HW_WRONG_APP' });
        await reach(mockLedger(async ({ chainId }) => {
            if (chainId === 'litecoin-mainnet') throw wrongApp;
            return address(chainId);
        }));

        await waitFor(() => expect(networkRow('litecoin-mainnet')).toHaveAttribute('data-wait', 'app'));
        expect(networkRow('dogecoin-mainnet').hasAttribute('data-wait')).toBe(false);
        expect(screen.queryByText(/Couldn't read accounts/)).toBeNull();
        expect(screen.getByRole('button', { name: 'Add Wallet' })).toBeEnabled();
    });

    it('any other failure keeps the networks already read and offers Try again for the list', async () => {
        await reach(mockLedger(async ({ chainId }) => {
            if (chainId === 'litecoin-mainnet') throw new Error('transport closed');
            return address(chainId);
        }));

        expect(await screen.findByText(/Couldn't read accounts from your Ledger/)).toBeInTheDocument();
        expect(networkRow('litecoin-mainnet').hasAttribute('data-wait')).toBe(false);
        expect(screen.getByRole('button', { name: 'Add Wallet' })).toBeEnabled();
    });
});
