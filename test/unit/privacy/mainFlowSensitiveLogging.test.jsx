// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { BackupSection } from '../../../packages/core/src/shared/components/settings/BackupSection.jsx';
import { Locked } from '../../../packages/core/src/shared/routes/Locked.jsx';
import { Receive } from '../../../packages/core/src/shared/routes/Receive.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';
import { clearLockoutState } from '../../../packages/core/src/flows/index.js';
import { logConsole } from '../../../packages/core/src/shared/utils/logConsole.js';

vi.mock('qrcode', () => ({
    default: { toDataURL: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo=') },
}));

const CHAIN_ID = 'bitcoin-mainnet';
const WALLET_ID = 'privacy-canary-wallet';
const ACCOUNT_ID = 'privacy-canary-account';
const FROM = 'bc1qsendersendersendersendersendersendersa';
const TO = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const RECEIVE_ADDRESS = 'bc1qprivacycanary000000000000000000000000000';
const PASSWORD = 'unlock-password-9Yx4-private-canary';
const MNEMONIC = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const PRIVATE_KEY = '1111111111111111111111111111111111111111111111111111111111111111';
const BALANCE_SATS = '987654321';
const BALANCE_BTC = '9.87654321';
const SEND_AMOUNT = '0.01234567';
const RECEIVE_AMOUNT = '2.50000000';

const SETTINGS = {
    schemaVersion: 1,
    activeNetwork: 'mainnet',
    walletMode: 'full',
    fees: { [CHAIN_ID]: { strategy: 'normal' } },
    grace: { testSendThresholdSats: 0 },
    privacy: { formDraftTtlMs: 0 },
};

function stringifyLogged(value) {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.stack || value.message;
    try {
        return JSON.stringify(value, (_key, nested) => (
            nested instanceof Error
                ? { name: nested.name, message: nested.message, stack: nested.stack }
                : nested
        ));
    } catch {
        return String(value);
    }
}

function sendMessaging() {
    const address = {
        id: 'source-address',
        address: FROM,
        publicKey: '02ab',
        privateKey: PRIVATE_KEY,
        derivationPath: "m/84'/0'/0'/0/0",
        source: 'hd',
    };
    const base = {
        getAddressesByChain: vi.fn(async () => ({ [CHAIN_ID]: [address] })),
        getActiveAddresses: vi.fn(async () => ({ [CHAIN_ID]: address })),
        getAddressBalances: vi.fn(async () => ({
            native: { tick: 'BTC', quantity: BALANCE_SATS, divisibility: 8 },
            tokens: [],
        })),
        getSettings: vi.fn(async () => SETTINGS),
        updateSettings: vi.fn(async () => SETTINGS),
        signerReady: vi.fn(async () => ({ ready: false })),
        getSignerStatus: vi.fn(async () => ({ unlocked: false })),
        listContacts: vi.fn(async () => []),
        getRecentDestinations: vi.fn(async () => []),
        getAddressHistory: vi.fn(async () => []),
        gatedSendReadiness: vi.fn(async () => ({ state: 'ungated' })),
        composeForConfirm: vi.fn(async () => ({
            psbt: '70736274ff',
            encoding: 'P2SH',
            actionString: `SEND|1|BTC|${SEND_AMOUNT}|${TO}`,
            version: 1,
            chainId: CHAIN_ID,
            networkFeeSats: 1234,
            decoded: {
                summary: `Send ${SEND_AMOUNT} BTC`,
                details: [
                    { label: 'Token', value: 'BTC' },
                    { label: 'Amount', value: SEND_AMOUNT },
                    { label: 'Destination', value: TO },
                ],
                warnings: [],
            },
            simulation: {
                deltas: [{ tick: 'BTC', before: BALANCE_BTC, after: '9.86419754' }],
                notes: [],
            },
        })),
    };
    return new Proxy(base, {
        get(target, property) {
            if (property in target) return target[property];
            if (typeof property !== 'string') return undefined;
            const stub = vi.fn(async () => null);
            target[property] = stub;
            return stub;
        },
    });
}

function receiveMessaging() {
    const address = {
        id: 'receive-address',
        address: RECEIVE_ADDRESS,
        publicKey: '03cd',
        privateKey: PRIVATE_KEY,
        addressType: 'p2wpkh',
        derivationPath: "m/84'/0'/0'/0/1",
        source: 'hd',
        label: 'Privacy canary deposits',
    };
    return {
        getSettings: vi.fn(async () => SETTINGS),
        getAddressesByChain: vi.fn(async () => ({ [CHAIN_ID]: [address] })),
        getNewestAddress: vi.fn(async () => address),
    };
}

function renderWithMessaging(messaging, child) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ToastHost>{child}</ToastHost>
        </MessagingProvider>,
    );
}

afterEach(() => {
    cleanup();
    clearLockoutState();
    logConsole.detach();
    logConsole.detachMirror();
    logConsole.clear();
    localStorage.clear();
    vi.restoreAllMocks();
});

describe('main flow logging privacy', () => {
    it('keeps unlock, send review, receive, and backup secrets out of every log sink', async () => {
        clearLockoutState();
        logConsole.detach();
        logConsole.clear();
        const consoleSpies = ['log', 'info', 'warn', 'error', 'debug'].map((level) => (
            vi.spyOn(console, level).mockImplementation(() => {})
        ));
        const diagnosticRecord = vi.spyOn(logConsole, 'record');
        logConsole.attach();

        const unlockWallet = vi.fn(async () => ({
            unlocked: true,
            passphraseCaptureNeeded: [],
        }));
        const onUnlocked = vi.fn();
        renderWithMessaging({ unlockWallet }, <Locked onUnlocked={onUnlocked} />);
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
        fireEvent.click(screen.getByRole('button', { name: 'Unlock Wallet' }));
        await waitFor(() => expect(onUnlocked).toHaveBeenCalledOnce());
        expect(unlockWallet).toHaveBeenCalledWith(PASSWORD);
        cleanup();

        const send = sendMessaging();
        renderWithMessaging(send, <Send walletId={WALLET_ID} />);
        fireEvent.change(await screen.findByLabelText(/^To$/), { target: { value: TO } });
        fireEvent.change(screen.getByLabelText(/^Amount \(/), { target: { value: SEND_AMOUNT } });
        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
        await screen.findByTestId('confirm-modal');
        expect(send.composeForConfirm).toHaveBeenCalledOnce();
        cleanup();

        renderWithMessaging(
            receiveMessaging(),
            <Receive walletId={WALLET_ID} accountId={ACCOUNT_ID} />,
        );
        const receiveAmount = await screen.findByRole('textbox', { name: 'Amount (BTC)' });
        fireEvent.change(receiveAmount, { target: { value: RECEIVE_AMOUNT } });
        await waitFor(() => expect(screen.getByText(RECEIVE_ADDRESS)).toBeInTheDocument());
        cleanup();

        const revealMnemonicRequest = vi.fn(async () => ({
            mnemonic: MNEMONIC,
            format: 'bip39',
            passphraseEnabled: false,
            bip39Passphrase: null,
        }));
        renderWithMessaging(
            { revealMnemonicRequest },
            <BackupSection activeWallet={{ id: WALLET_ID, name: 'Privacy canary' }} />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Show…' }));
        fireEvent.change(screen.getByLabelText('Wallet password'), {
            target: { value: PASSWORD },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
        await screen.findByText(MNEMONIC);
        expect(revealMnemonicRequest).toHaveBeenCalledWith({
            walletId: WALLET_ID,
            password: PASSWORD,
        });

        logConsole.detach();
        const loggedValues = [
            ...consoleSpies.flatMap((spy) => spy.mock.calls),
            ...diagnosticRecord.mock.calls.flat(),
            ...logConsole.entries(),
        ].map(stringifyLogged);
        const phraseWords = [...new Set(MNEMONIC.split(' '))];

        for (const secret of [PASSWORD, PRIVATE_KEY, MNEMONIC, ...phraseWords]) {
            expect(loggedValues.filter((value) => value.includes(secret)), secret).toEqual([]);
        }

        const addressBalancePairs = [
            [FROM, BALANCE_SATS],
            [FROM, BALANCE_BTC],
            [TO, SEND_AMOUNT],
            [RECEIVE_ADDRESS, RECEIVE_AMOUNT],
        ];
        for (const [address, balance] of addressBalancePairs) {
            expect(
                loggedValues.filter((value) => value.includes(address) && value.includes(balance)),
                `${address} with ${balance}`,
            ).toEqual([]);
        }
    });
});
