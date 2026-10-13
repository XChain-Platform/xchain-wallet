// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    act,
    cleanup,
    fireEvent,
    render,
    renderHook,
    screen,
    waitFor,
} from '@testing-library/react';

const nextPaint = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('../../../packages/core/src/shared/utils/nextPaint.js', () => ({ nextPaint }));
vi.mock('qrcode', () => ({
    default: { toDataURL: vi.fn(async () => 'data:image/png;base64,Y2hhb3M=') },
}));

import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BackupSection } from '../../../packages/core/src/shared/components/settings/BackupSection.jsx';
import { useConfirmAction } from '../../../packages/core/src/shared/hooks/useConfirmAction.js';
import { Locked } from '../../../packages/core/src/shared/routes/Locked.jsx';
import {
    clearDemoWalletId,
    clearLockoutState,
} from '../../../packages/core/src/flows/index.js';
import { createBroadcastQueueEngine } from '../../../packages/extension/src/background/broadcastQueueEngine.js';
import { createBroadcastQueueStore } from '../../../packages/extension/src/background/broadcastQueueStore.js';

const RESTART_MESSAGE = 'The message port closed before a response was received.';
const CHAIN = 'bitcoin-regtest';
const WALLET = 'wallet-restart';
const SOURCE = 'bcrt1qrestartsource';
const SIGNED_HEX = '020000000001aabb';
const TXID = 'ab'.repeat(32);
const BACKUP_PASSWORD = 'backup-secret';
const BACKUP_CONTENT = JSON.stringify({
    magic: 'XCHAIN-WALLET-BACKUP',
    formatVersion: 1,
    createdAt: '2026-10-13T18:00:00.000Z',
    walletName: 'Restart Wallet',
    encryption: {
        algorithm: 'aes-256-gcm',
        kdf: {
            algorithm: 'argon2id',
            salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
            iterations: 3,
            memory: 65536,
            parallelism: 1,
        },
        iv: 'AAAAAAAAAAAAAAAA',
        tag: 'AAAAAAAAAAAAAAAAAAAAAA==',
    },
    payload: 'encrypted-payload',
}, null, 2);

function restartError() {
    return new Error(RESTART_MESSAGE);
}

function collection(initial = []) {
    const rows = new Map(initial.map((row) => [row.id, structuredClone(row)]));
    return {
        async get(id) { return rows.has(id) ? structuredClone(rows.get(id)) : null; },
        async put(row) { rows.set(row.id, structuredClone(row)); },
        async list() { return [...rows.values()].map((row) => structuredClone(row)); },
        async findBy(field, value) {
            return [...rows.values()]
                .filter((row) => row[field] === value)
                .map((row) => structuredClone(row));
        },
    };
}

function memoryQueueStorage() {
    let queues = {};
    let settlements = [];
    return {
        async load() { return structuredClone(queues); },
        async save(next) { queues = structuredClone(next); },
        async loadSettlements() { return structuredClone(settlements); },
        async saveSettlements(next) { settlements = structuredClone(next); },
        async clear() { queues = {}; settlements = []; },
    };
}

beforeEach(() => {
    clearDemoWalletId();
    clearLockoutState();
    nextPaint.mockClear();
    localStorage.clear();
});

afterEach(() => {
    cleanup();
    clearLockoutState();
    vi.restoreAllMocks();
});

describe('chaos/background/restart-mid-flow', () => {
    it('stays locked and permits a fresh unlock after the worker restarts', async () => {
        const unlockWallet = vi.fn()
            .mockRejectedValueOnce(restartError())
            .mockResolvedValueOnce({ passphraseCaptureNeeded: [] });
        const onUnlocked = vi.fn();
        render(
            <MessagingProvider shell="popup" messaging={{ unlockWallet }}>
                <Locked onUnlocked={onUnlocked} />
            </MessagingProvider>,
        );

        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wallet password' } });
        fireEvent.click(screen.getByRole('button', { name: 'Unlock Wallet' }));

        expect(await screen.findByText(RESTART_MESSAGE)).toBeInTheDocument();
        expect(onUnlocked).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Unlock Wallet' })).toBeEnabled();

        fireEvent.click(screen.getByRole('button', { name: 'Unlock Wallet' }));
        await waitFor(() => expect(onUnlocked).toHaveBeenCalledOnce());
        expect(unlockWallet).toHaveBeenCalledTimes(2);
    });

    it('keeps the reviewed PSBT unsigned when its background preflight restarts', async () => {
        const composed = {
            actionString: 'SEND|0|TBTC|1|destination',
            action: 'SEND',
            version: 0,
            psbt: 'reviewed-psbt',
            encoding: 'OP_RETURN',
            expectedOutputs: { addressed: [], encoding: 'OP_RETURN' },
            tamperVerified: true,
        };
        const preflight = vi.fn(async () => { throw restartError(); });
        const onApprove = vi.fn(async (_credentials, built) => ({ psbt: built.psbt }));
        const { result } = renderHook(() => useConfirmAction());
        let pending;

        await act(async () => {
            pending = result.current.confirm({
                chainId: CHAIN,
                compose: async () => composed,
                preflight,
                onApprove,
            });
        });
        await waitFor(() => expect(result.current.phase).toBe('ready'));

        expect(result.current.composed.psbt).toBe('reviewed-psbt');
        expect(onApprove).not.toHaveBeenCalled();

        let approved;
        await act(async () => {
            approved = await result.current.approve({ password: 'wallet password' });
        });
        await expect(pending).resolves.toEqual({ psbt: 'reviewed-psbt' });
        expect(approved).toEqual({ psbt: 'reviewed-psbt' });
        expect(onApprove).toHaveBeenCalledTimes(1);
    });

    it('restores the exact signed transaction after restart during relay broadcast', async () => {
        const pendingTxs = collection();
        const vault = {
            settings: { get: async () => ({ ads: { enabled: false, perChain: {} } }) },
            pendingTxs,
            accounts: collection([{ id: 'account-1', walletId: WALLET }]),
            addresses: collection([{ id: 'address-1', accountId: 'account-1', address: SOURCE }]),
        };
        const broadcastTx = vi.fn(() => new Promise(() => {}));
        const signer = {
            kind: 'software',
            signPsbt: vi.fn(async () => ({
                signedPsbtHex: 'signed-psbt',
                txHex: SIGNED_HEX,
                txid: TXID,
            })),
        };
        const sdk = {
            encoder: { broadcastTx },
            wallet: { decomposePsbt: () => ({ inputs: [{}], outputs: [] }) },
        };
        const chainRegistry = {
            get: () => ({ id: CHAIN, coin: 'bitcoin', networkKind: 'regtest' }),
            chainIdFor: () => CHAIN,
        };

        void submitAction({
            vault,
            walletId: WALLET,
            chainRegistry,
            sdkRegistry: { get: () => sdk },
            chainId: CHAIN,
            actionData: {
                action: 'SEND',
                params: { VERSION: '0', TICK: 'TBTC', AMOUNT: '1', DESTINATION: 'bcrt1qdestination' },
            },
            encoderOpts: { pubkey: '03abc', sourceAddress: SOURCE, change: SOURCE },
            prebuiltPsbt: {
                psbtHex: 'reviewed-psbt',
                encoding: 'OP_RETURN',
                actionString: 'SEND|0|TBTC|1|bcrt1qdestination',
            },
            signingPaths: [{ inputIndex: 0, path: "m/84'/1'/0'/0/0" }],
            signer,
            pendingTxMeta: {
                fromAddress: SOURCE,
                toAddress: 'bcrt1qdestination',
                actionSummary: 'Send 1 TBTC',
            },
        });

        await vi.waitFor(() => expect(broadcastTx).toHaveBeenCalledOnce());
        const [checkpoint] = await pendingTxs.findBy('status', 'broadcasting');
        expect(checkpoint).toMatchObject({ txid: TXID, txHex: SIGNED_HEX });

        const store = createBroadcastQueueStore({ storage: memoryQueueStorage(), prunedLedger: null });
        const restarted = createBroadcastQueueEngine({
            store,
            importedAddressIdsFor: async () => new Set(),
            discardQueuedBroadcast: async () => {},
        });
        await restarted.ensureQueueLoaded();
        await restarted.restoreQueueFromVault(vault, chainRegistry, WALLET);

        expect(restarted.getQueue(WALLET)).toEqual([
            expect.objectContaining({
                signedTxHex: SIGNED_HEX,
                txid: TXID,
                pendingTxId: checkpoint.id,
                resumedClaim: true,
            }),
        ]);
        expect(signer.signPsbt).toHaveBeenCalledOnce();
        expect(broadcastTx).toHaveBeenCalledOnce();
    });

    it('returns backup export to a retryable prompt after the worker restarts', async () => {
        const exportBackupFile = vi.fn()
            .mockRejectedValueOnce(restartError())
            .mockResolvedValueOnce({ fileContent: BACKUP_CONTENT });
        const originalCreateObjectURL = URL.createObjectURL;
        const originalRevokeObjectURL = URL.revokeObjectURL;
        const originalClick = HTMLAnchorElement.prototype.click;
        URL.createObjectURL = vi.fn(() => 'blob:restart-backup');
        URL.revokeObjectURL = vi.fn();
        HTMLAnchorElement.prototype.click = vi.fn();
        try {
            render(
                <MessagingProvider shell="popup" messaging={{ exportBackupFile }}>
                    <BackupSection activeWallet={{ id: WALLET, name: 'Restart Wallet' }} />
                </MessagingProvider>,
            );
            fireEvent.click(screen.getByRole('button', { name: 'Export…' }));
            fireEvent.change(screen.getByLabelText('Backup password'), {
                target: { value: BACKUP_PASSWORD },
            });
            fireEvent.change(screen.getByLabelText('Confirm backup password'), {
                target: { value: BACKUP_PASSWORD },
            });
            fireEvent.click(screen.getByRole('button', { name: 'Export' }));

            expect(await screen.findByText(RESTART_MESSAGE)).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled();
            expect(URL.createObjectURL).not.toHaveBeenCalled();

            fireEvent.click(screen.getByRole('button', { name: 'Export' }));
            expect(await screen.findByText('Backup file saved')).toBeInTheDocument();
            expect(exportBackupFile).toHaveBeenCalledTimes(2);
            expect(URL.createObjectURL).toHaveBeenCalledOnce();
        } finally {
            URL.createObjectURL = originalCreateObjectURL;
            URL.revokeObjectURL = originalRevokeObjectURL;
            HTMLAnchorElement.prototype.click = originalClick;
        }
    });
});
