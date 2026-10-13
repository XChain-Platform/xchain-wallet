// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Locked } from '../../../packages/core/src/shared/routes/Locked.jsx';
import { Onboarding } from '../../../packages/core/src/shared/routes/Onboarding.jsx';
import { LICENSE_VERSION } from '../../../packages/core/src/buildInfo.js';

const META_KEY = 'xchain-wallet:vault-meta';
const DEMO_KEYS = [
    'xc:demoWalletId',
    'xc:demoWalletCreatedAt',
    'xc:demoWalletTtlMs',
    'xc:demoWalletPassword',
];
const WALLET_KEYS = [
    META_KEY,
    'xchain-wallet:biometric',
    'xchain.broadcastQueue',
    'xchain.broadcastQueue.pruned.wallet-1',
    'xchain-wallet:lockout',
    'xchain-wallet:panic',
    'xchain-wallet:duress',
    'xc:activeWallet',
    'xc:activeAccount:wallet-1',
    'xc:backupVerifiedAt',
    'xc:backupReminderDismissedUntil',
    'xc:envelopeCommits',
    'xc:lastView:wallet-1',
    'xc:msgRead:wallet-1:account-1',
    'xc:msgUnread:wallet-1:account-1',
    'xc:msgRequestDeclined:wallet-1:account-1',
    'xc:formdraft:send:wallet-1',
    'xc:chainFilter:history:wallet-1',
    'xc:contacts:sort:wallet-1',
    'xc:historyGroupingMode:wallet-1',
];

let reload;
let databases;

function installMockedWalletStorage() {
    databases = new Map([
        ['xchain-wallet', new Map([['wallet-vault', 'encrypted wallet data']])],
    ]);
    globalThis.indexedDB = {
        deleteDatabase(name) {
            const request = {};
            queueMicrotask(() => {
                databases.delete(name);
                request.onsuccess?.();
            });
            return request;
        },
    };
    for (const key of WALLET_KEYS) localStorage.setItem(key, `wallet data for ${key}`);
    localStorage.setItem('xc:licenseAcceptedAt', '2026-01-01T00:00:00.000Z');
    localStorage.setItem('xc:licenseAcceptedVersion', LICENSE_VERSION);
    localStorage.setItem('xc:onboardingExplainerSeenAt', '2026-01-01T00:00:00.000Z');
    localStorage.setItem('unrelated.preference', 'keep');
}

function ResettableShell() {
    const [hasWallet, setHasWallet] = useState(() => localStorage.getItem(META_KEY) !== null);
    reload.mockImplementation(() => setHasWallet(localStorage.getItem(META_KEY) !== null));
    return (
        <MessagingProvider shell="web" messaging={{ unlockWallet: vi.fn() }}>
            {hasWallet
                ? <Locked onUnlocked={() => setHasWallet(false)} />
                : <Onboarding onCreate={() => {}} onImport={() => {}} />}
        </MessagingProvider>
    );
}

beforeEach(() => {
    localStorage.clear();
    installMockedWalletStorage();
    reload = vi.fn();
    Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: { reload },
    });
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    delete globalThis.indexedDB;
    delete globalThis.location;
});

describe('reset app flow', () => {
    it('requires WIPE, names the erased data, and returns an empty shell to onboarding', async () => {
        render(<ResettableShell />);

        fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
        fireEvent.click(screen.getByRole('button', { name: 'Use recovery phrase' }));
        const dialog = screen.getByRole('alertdialog', { name: 'Restore wallet access' });
        expect(dialog).toHaveTextContent(/every wallet saved in this app on this device/i);
        expect(dialog).toHaveTextContent(/recovery information, accounts, addresses, and queued transactions/i);

        const wipeButton = screen.getByRole('button', { name: 'Erase vault and restore' });
        expect(wipeButton).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Type WIPE to confirm'), {
            target: { value: 'not wipe' },
        });
        expect(wipeButton).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Type WIPE to confirm'), {
            target: { value: 'WIPE' },
        });
        expect(wipeButton).toBeEnabled();
        for (const key of DEMO_KEYS) localStorage.setItem(key, `stale data for ${key}`);
        fireEvent.click(wipeButton);

        expect(await screen.findByRole('button', { name: 'Create new wallet' })).toBeEnabled();
        expect(reload).toHaveBeenCalledTimes(1);
        expect(databases.has('xchain-wallet')).toBe(false);
        await waitFor(() => {
            expect([...WALLET_KEYS, ...DEMO_KEYS]
                .filter((key) => localStorage.getItem(key) !== null)).toEqual([]);
        });
        expect(localStorage.getItem('unrelated.preference')).toBe('keep');
        expect(localStorage.getItem('xc:licenseAcceptedVersion')).toBe(LICENSE_VERSION);
    });
});
