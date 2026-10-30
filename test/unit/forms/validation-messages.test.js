// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    cleanup,
    fireEvent,
    render,
    screen,
} from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';
import { TokenWizard } from '../../../packages/core/src/shared/routes/TokenWizard.jsx';
import { DispenserForm } from '../../../packages/core/src/shared/routes/DispenserForm.jsx';
import { ContactsList } from '../../../packages/core/src/shared/routes/ContactsList.jsx';
import { addressValidationError } from '../../../packages/core/src/shared/utils/addressValidation.js';
import {
    tickerGrammarError,
    tickerReferenceError,
} from '../../../packages/core/src/shared/utils/tickerGrammar.js';

const CHAIN_ID = 'bitcoin-mainnet';
const FROM = 'bc1qsendersendersendersendersendersendersa';
const BITCOIN_TO = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const LITECOIN_TO = 'LVg2kJoFNg45Nbpy53h7Fe1wKyeXVRhMH9';
const SOURCE = {
    id: 'address-1',
    address: FROM,
    publicKey: '02ab',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};

function expectPlainCopy(value) {
    const text = typeof value === 'string' ? value : value.textContent;
    expect(text?.trim().length).toBeGreaterThan(0);
    expect(text).not.toMatch(/\b(?:ERR|E)_[A-Z0-9_]+\b/);
    expect(text).not.toMatch(/\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/);
    expect(text).not.toMatch(/(?:^|\n)\s*at\s+\S+/);
    expect(text).not.toMatch(/\b(?:Type|Reference)?Error:/i);
}

function messagingProxy(overrides = {}) {
    const target = { ...overrides };
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            if (typeof property !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            object[property] = stub;
            return stub;
        },
    });
}

function mountSend({ quantity = '100000000' } = {}) {
    const balances = {
        native: { tick: 'BTC', quantity, divisibility: 8 },
        tokens: [],
    };
    const messaging = messagingProxy({
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN_ID]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN_ID]: SOURCE }),
        getAddressBalances: vi.fn().mockResolvedValue(balances),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN_ID]: [{ address: FROM, balances, error: null }],
        }),
        getSettings: vi.fn().mockResolvedValue({
            walletMode: 'full',
            activeNetwork: 'mainnet',
            grace: { testSendThresholdSats: 0 },
            privacy: { formDraftTtlMs: 0 },
        }),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
        getAddressHistory: vi.fn().mockResolvedValue([]),
        gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: 'aa00',
            encoding: 'psbt',
            actionString: 'SEND|1|BTC|1',
            version: 1,
            decoded: { summary: 'Send', details: [], warnings: [] },
            simulation: { deltas: [], notes: [] },
        }),
    });
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(Send, { walletId: 'wallet', onBack() {} }),
    ));
    return messaging;
}

function mountWizard() {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN_ID]: [SOURCE] }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: 'aa00', encoding: 'psbt', actionString: 'ISSUE', version: 0,
        }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
    };
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(TokenWizard, { walletId: 'wallet', onBack() {} }),
    ));
    return messaging;
}

function mountDispenser() {
    const messaging = messagingProxy({
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN_ID]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN_ID]: SOURCE }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getWalletBalances: vi.fn().mockResolvedValue({ [CHAIN_ID]: [] }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: 'aa00', encoding: 'psbt', actionString: 'DISPENSER', version: 1,
        }),
    });
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(DispenserForm, {
            walletId: 'wallet',
            initialChainId: CHAIN_ID,
            initialTick: 'SALE',
            onBack() {},
        }),
    ));
    return messaging;
}

function mountContacts() {
    const messaging = {
        listContacts: vi.fn().mockResolvedValue([]),
        saveContact: vi.fn().mockResolvedValue(null),
        deleteContact: vi.fn().mockResolvedValue(null),
    };
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(ContactsList, { walletId: 'wallet', onBack() {} }),
    ));
    return messaging;
}

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
});

describe('shared validation messages', () => {
    it.each([
        ['an empty token name', '', tickerGrammarError('', { noun: 'Token name' }), 'Token name is required.'],
        ['a whitespace token name', '   ', tickerGrammarError('   ', { noun: 'Token name' }), 'Token name is required.'],
        ['an empty dispenser ticker', '', tickerReferenceError('', { noun: 'Token ticker' }), 'Token ticker is required.'],
        ['a whitespace dispenser ticker', '\t \n', tickerReferenceError('\t \n', { noun: 'Token ticker' }), 'Token ticker is required.'],
    ])('returns plain copy for %s', (_label, _input, message, expected) => {
        expect(message).toBe(expected);
        expectPlainCopy(message);
    });

    it('names the wrong network without exposing a validator code', () => {
        const message = addressValidationError(LITECOIN_TO, {
            coin: 'bitcoin',
            networkKind: 'mainnet',
        });

        expect(message).toBe(
            'This is a Litecoin mainnet address, not a Bitcoin mainnet address.',
        );
        expectPlainCopy(message);
    });
});

describe('Send field validation', () => {
    it.each([
        ['empty', ''],
        ['whitespace-only', '   '],
    ])('rejects a recipient that is %s with plain copy', async (_label, recipient) => {
        mountSend();
        const to = await screen.findByLabelText(/^To$/);
        fireEvent.change(to, { target: { value: recipient } });
        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));

        const message = await screen.findByText('Enter a recipient address.');
        expectPlainCopy(message);
    });

    it('rejects a wrong-network recipient with plain copy', async () => {
        mountSend();
        fireEvent.change(await screen.findByLabelText(/^To$/), {
            target: { value: LITECOIN_TO },
        });
        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));

        const [message] = await screen.findAllByText(
            'This looks like a Litecoin address, not a Bitcoin address.',
        );
        expectPlainCopy(message);
    });

    it('rejects a negative amount and excessive decimal places with plain copy', async () => {
        mountSend();
        const amount = await screen.findByLabelText(/^Amount \(/);

        fireEvent.change(amount, { target: { value: '-1' } });
        const negative = await screen.findByText(/Enter a valid decimal amount/);
        expectPlainCopy(negative);

        fireEvent.change(amount, { target: { value: '1.123456789' } });
        const precision = await screen.findByText('Amount can have at most 8 decimal places.');
        expectPlainCopy(precision);
    });

    it('rejects an amount above the available balance with plain copy', async () => {
        const messaging = mountSend({ quantity: '100000000' });
        fireEvent.change(await screen.findByLabelText(/^To$/), {
            target: { value: BITCOIN_TO },
        });
        fireEvent.change(screen.getByLabelText(/^Amount \(/), { target: { value: '2' } });
        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));

        const message = await screen.findByText('Amount exceeds the available balance.');
        expectPlainCopy(message);
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });
});

describe('Create token field validation', () => {
    it('rejects whitespace, negative supply, and excessive decimals with plain copy', async () => {
        const messaging = mountWizard();
        fireEvent.click(await screen.findByText('Utility token'));
        await screen.findByLabelText('Fee paid by');
        fireEvent.submit(screen.getByRole('form', { name: 'Choose token network' }));
        await screen.findByText('Step 3 of 4: Details');

        const name = screen.getByLabelText('Token name (ticker)');
        const supply = screen.getByLabelText('Supply');
        const form = screen.getByRole('form', { name: 'Token details' });
        fireEvent.change(name, { target: { value: '   ' } });
        fireEvent.change(supply, { target: { value: '1' } });
        fireEvent.submit(form);
        const required = await screen.findByText('Token name is required.');
        expectPlainCopy(required);

        fireEvent.change(name, { target: { value: 'UTILITY' } });
        fireEvent.change(supply, { target: { value: '-1' } });
        fireEvent.submit(form);
        const positive = await screen.findByText('Supply must be a positive number.');
        expectPlainCopy(positive);

        fireEvent.click(screen.getByLabelText('Divisible (8 decimal places)'));
        fireEvent.change(supply, { target: { value: '1.123456789' } });
        fireEvent.submit(form);
        const precision = await screen.findByText('Supply can have at most 8 decimal places.');
        expectPlainCopy(precision);
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });
});

describe('Create dispenser field validation', () => {
    it('rejects a negative amount and excessive fiat decimals with plain copy', async () => {
        const messaging = mountDispenser();
        const give = await screen.findByLabelText(/^Give amount/);
        fireEvent.change(give, { target: { value: '-1' } });
        const negative = await screen.findByText(/Enter a valid decimal amount/);
        expectPlainCopy(negative);

        fireEvent.change(give, { target: { value: '10' } });
        fireEvent.change(screen.getByLabelText(/^Escrow amount/), { target: { value: '100' } });
        fireEvent.click(screen.getByRole('button', { name: /Advanced options/ }));
        fireEvent.change(screen.getByLabelText('Priced in fiat (optional)'), {
            target: { value: 'USD' },
        });
        fireEvent.change(screen.getByLabelText(/^Fiat amount/), {
            target: { value: '12.345' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Create' }));

        const precision = await screen.findByText(
            'Fiat amount can have at most 2 decimal places, like 12.34 or 3.',
        );
        expectPlainCopy(precision);
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });
});

describe('Contacts field validation', () => {
    it('rejects empty and whitespace-only fields with plain copy', async () => {
        const messaging = mountContacts();
        await screen.findByText('No contacts yet');
        fireEvent.click(screen.getByRole('button', { name: 'Create first contact' }));

        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        const emptyName = await screen.findByText('Name is required.');
        expectPlainCopy(emptyName);

        fireEvent.change(screen.getByLabelText('Name'), { target: { value: '   ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        const whitespaceName = await screen.findByText('Name is required.');
        expectPlainCopy(whitespaceName);

        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Alice' } });
        fireEvent.change(screen.getByLabelText('Address'), { target: { value: '   ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        const emptyAddress = await screen.findByText('At least one address entry is required.');
        expectPlainCopy(emptyAddress);
        expect(messaging.saveContact).not.toHaveBeenCalled();
    });
});
