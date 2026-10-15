// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';

const secrets = vi.hoisted(() => ({
    phrase: 'legal winner thank year wave sausage worth useful legal winner thank yellow',
}));

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        crypto: { ...actual.crypto, generateBip39Mnemonic: () => secrets.phrase },
    };
});

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CreateWallet } from '../../../packages/core/src/shared/routes/CreateWallet.jsx';
import { ImportWallet } from '../../../packages/core/src/shared/routes/ImportWallet.jsx';
import { ViewPrivateKey } from '../../../packages/core/src/shared/routes/ViewPrivateKey.jsx';

const PASSWORD = 'route-password-canary-8Qv7';
const PRIVATE_KEY = 'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn';
const ADDRESS = {
    id: 'address-1',
    address: 'bc1qexampleexampleexampleexampleexampleexample',
    source: 'hd',
    chain: 'bitcoin',
    network: 'mainnet',
    derivationPath: "m/84'/0'/0'/0/0",
    label: 'Main',
};

let storageWrites;
let consoleSpies;
let indexedDbOpen;

function stringify(value) {
    if (typeof value === 'string') return value;
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

function currentStorageValues(storage) {
    return Array.from({ length: storage.length }, (_value, index) => (
        storage.getItem(storage.key(index))
    ));
}

function domValues() {
    const controls = [...document.querySelectorAll('input, textarea, select')]
        .map((element) => element.value);
    return [document.body.textContent || '', ...controls].join('\n');
}

function expectSecretsAbsent(secretValues) {
    const persisted = [
        ...storageWrites.map(({ key, value }) => `${key}:${value}`),
        ...currentStorageValues(localStorage),
        ...currentStorageValues(sessionStorage),
    ].map(stringify);
    const logged = consoleSpies.flatMap((spy) => spy.mock.calls.flat()).map(stringify);

    expect(indexedDbOpen).not.toHaveBeenCalled();
    for (const secret of secretValues) {
        expect(domValues(), `DOM contains ${secret}`).not.toContain(secret);
        expect(persisted.filter((value) => value.includes(secret)), `storage contains ${secret}`).toEqual([]);
        expect(logged.filter((value) => value.includes(secret)), `console contains ${secret}`).toEqual([]);
    }
}

function RouteHarness({ messaging, children }) {
    const [active, setActive] = useState(true);
    return (
        <MessagingProvider shell="web" messaging={messaging}>
            {active ? children(() => setActive(false)) : <main>Destination route</main>}
        </MessagingProvider>
    );
}

beforeEach(() => {
    cleanup();
    localStorage.clear();
    sessionStorage.clear();
    storageWrites = [];
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItem(key, value) {
        storageWrites.push({ key, value });
        return originalSetItem.call(this, key, value);
    });
    consoleSpies = ['log', 'info', 'warn', 'error', 'debug'].map((level) => (
        vi.spyOn(console, level).mockImplementation(() => {})
    ));
    indexedDbOpen = vi.fn(() => {
        throw new Error('Sensitive routes must not open IndexedDB');
    });
    vi.stubGlobal('indexedDB', { open: indexedDbOpen });
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('sensitive route lifecycle', () => {
    it('removes a generated recovery phrase and password before leaving Create Wallet', () => {
        render(
            <RouteHarness messaging={{}}>
                {(leave) => <CreateWallet onBack={leave} onCreated={() => {}} />}
            </RouteHarness>,
        );

        fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
        fireEvent.change(screen.getByLabelText(/^Confirm/), { target: { value: PASSWORD } });
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        fireEvent.click(screen.getByRole('button', { name: 'Reveal recovery phrase' }));
        expect(within(screen.getByRole('list', { name: 'Recovery phrase' })).getByText('yellow'))
            .toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Back to previous step' }));
        fireEvent.click(screen.getByRole('button', { name: 'Back to wallet setup' }));

        expect(screen.getByText('Destination route')).toBeInTheDocument();
        expectSecretsAbsent([PASSWORD, secrets.phrase, ...new Set(secrets.phrase.split(' '))]);
    });

    it('removes typed recovery, private-key, and password values on leaving Import Wallet', () => {
        render(
            <RouteHarness messaging={{}}>
                {(leave) => <ImportWallet onBack={leave} onImported={() => {}} />}
            </RouteHarness>,
        );

        fireEvent.change(screen.getByLabelText('Recovery phrase'), {
            target: { value: secrets.phrase },
        });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
        fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: PASSWORD } });
        fireEvent.click(screen.getByRole('tab', { name: 'Private key' }));
        fireEvent.change(screen.getByLabelText('WIF private key'), {
            target: { value: PRIVATE_KEY },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Back to wallet setup' }));

        expect(screen.getByText('Destination route')).toBeInTheDocument();
        expectSecretsAbsent([PASSWORD, PRIVATE_KEY, secrets.phrase]);
    });

    it('removes a revealed private key when View Private Key requests navigation', async () => {
        const messaging = {
            exportPrivateKey: vi.fn(async () => ({ wif: PRIVATE_KEY })),
            getSettings: vi.fn(async () => ({
                privacy: { clipboardAutoClearSeconds: 30 },
            })),
        };
        const onBack = vi.fn();
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <ViewPrivateKey walletId="wallet-1" address={ADDRESS} onBack={onBack} />
            </MessagingProvider>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'I understand, continue' }));
        fireEvent.change(screen.getByLabelText('Wallet password'), {
            target: { value: PASSWORD },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Confirm password' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Tap to reveal private key' }));
        expect(screen.getByText(PRIVATE_KEY)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Done' }));

        expect(onBack).toHaveBeenCalledOnce();
        expect(screen.getByText('Before you continue')).toBeInTheDocument();
        expectSecretsAbsent([PASSWORD, PRIVATE_KEY]);
    });

    it('rejects a private-key response that arrives after navigation', async () => {
        let finishExport;
        const exportPrivateKey = vi.fn(() => new Promise((resolve) => { finishExport = resolve; }));
        const messaging = {
            exportPrivateKey,
            getSettings: vi.fn(async () => ({
                privacy: { clipboardAutoClearSeconds: 30 },
            })),
        };
        const onBack = vi.fn();
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <ViewPrivateKey walletId="wallet-1" address={ADDRESS} onBack={onBack} />
            </MessagingProvider>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'I understand, continue' }));
        fireEvent.change(screen.getByLabelText('Wallet password'), {
            target: { value: PASSWORD },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Confirm password' }));
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        await act(async () => { finishExport({ wif: PRIVATE_KEY }); });

        expect(onBack).toHaveBeenCalledOnce();
        expect(screen.getByText('Before you continue')).toBeInTheDocument();
        expectSecretsAbsent([PASSWORD, PRIVATE_KEY]);
    });
});
