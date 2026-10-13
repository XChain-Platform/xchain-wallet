// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import React from 'react';
import { HDKey } from '@scure/bip32';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMultisigConfig } from '../../../packages/core/src/flows/createMultisigConfig.js';
import {
    contributeMultisigSignature,
    finalizeMultisigSigningSession,
    startMultisigSigningSession,
} from '../../../packages/core/src/flows/multisigSigning.js';
import {
    buildReplyEnvelope,
    encodeMultisigEnvelope,
    encodeXcwChunks,
    fingerprintSessionRef,
} from '../../../packages/core/src/uri/index.js';

let messaging;
const toDataURL = vi.hoisted(() => vi.fn());

vi.mock('qrcode', () => ({ default: { toDataURL } }));
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging, shell: 'web' }),
    screenVariantFor: () => 'full',
}));

const { MultisigCreate } = await import(
    '../../../packages/core/src/shared/routes/MultisigCreate.jsx');
const { MultisigCosignerShare } = await import(
    '../../../packages/core/src/shared/routes/MultisigCosignerShare.jsx');
const { MultisigSigningSession } = await import(
    '../../../packages/core/src/shared/routes/MultisigSigningSession.jsx');

const TESTNET_VERSIONS = { private: 0x04358394, public: 0x043587cf };
const WALLET_ID = 'wallet-1';
const CHAIN_ID = 'bitcoin-testnet';
const PSBT_HEX = '70736274ff';
const MSG_HASH = 'ab'.repeat(32);
const SIGNATURE = '30'.repeat(35);

function cosigner(seed, fingerprint) {
    const account = HDKey.fromMasterSeed(new Uint8Array(32).fill(seed), TESTNET_VERSIONS)
        .derive("m/48'/1'/0'");
    const child = account.derive('m/0/0');
    return {
        xpub: account.publicExtendedKey,
        pubkey: Array.from(child.publicKey, (byte) => byte.toString(16).padStart(2, '0')).join(''),
        fingerprint,
        derivationPath: "m/48'/1'/0'/0/0",
        accountPath: "m/48'/1'/0'",
    };
}

const LOCAL = cosigner(1, '11111111');
const BOB = cosigner(2, '22222222');
const CAROL = cosigner(3, '33333333');
const LOCAL_ADDRESS = {
    id: 'address-1',
    address: 'tb1qmultisiglocal',
    label: 'Multisig key',
    publicKey: LOCAL.pubkey,
    derivationPath: LOCAL.derivationPath,
    source: 'hd',
};

function collection(initial = []) {
    const records = new Map(initial.map((record) => [record.id, record]));
    return {
        records,
        get: vi.fn(async (id) => records.get(id) || null),
        list: vi.fn(async () => [...records.values()]),
        put: vi.fn(async (record) => { records.set(record.id, record); }),
    };
}

function makeHarness() {
    const wallets = collection([{ id: WALLET_ID, name: 'Shared wallet', multisigs: [] }]);
    const sessions = collection();
    const finalizeMultisigPsbt = vi.fn(() => ({
        psbtHex: '00',
        txHex: '02000000000100',
        txid: 'finalized-txid',
    }));
    const broadcastTx = vi.fn(async () => ({ txid: 'broadcast-txid' }));
    const sdkRegistry = {
        get: vi.fn(() => ({
            wallet: { finalizeMultisigPsbt },
            encoder: { broadcastTx },
        })),
    };
    return {
        vault: { wallets, multisigSigningSessions: sessions },
        sdkRegistry,
        finalizeMultisigPsbt,
        broadcastTx,
    };
}

async function fillExternalRows() {
    const xpubs = screen.getAllByLabelText(/^xpub$/i);
    const pubkeys = screen.getAllByLabelText(/Public key \(hex/i);
    const fingerprints = screen.getAllByLabelText(/Master fingerprint/i);
    const paths = screen.getAllByLabelText(/^Derivation path/i);
    fireEvent.change(xpubs[0], { target: { value: BOB.xpub } });
    fireEvent.change(pubkeys[1], { target: { value: BOB.pubkey } });
    fireEvent.change(fingerprints[1], { target: { value: BOB.fingerprint } });
    fireEvent.change(paths[1], { target: { value: BOB.derivationPath } });
    fireEvent.change(xpubs[1], { target: { value: CAROL.xpub } });
    fireEvent.change(pubkeys[2], { target: { value: CAROL.pubkey } });
    fireEvent.change(fingerprints[2], { target: { value: CAROL.fingerprint } });
    fireEvent.change(paths[2], { target: { value: CAROL.derivationPath } });
}

beforeEach(() => {
    toDataURL.mockReset();
    toDataURL.mockResolvedValue('data:image/png,multisig-flow');
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('multisig jsdom flow', () => {
    it('creates 2-of-3, shares a cosigner, collects a reply, finalizes, and broadcasts', async () => {
        const harness = makeHarness();
        const cosignerInfo = {
            ...LOCAL,
            addressId: LOCAL_ADDRESS.id,
            address: LOCAL_ADDRESS.address,
        };
        messaging = {
            getAddressesByChain: vi.fn(async () => ({ [CHAIN_ID]: [LOCAL_ADDRESS] })),
            getMultisigCosignerInfo: vi.fn(async () => cosignerInfo),
            createMultisigConfig: vi.fn((request) => createMultisigConfig({
                ...request,
                vault: harness.vault,
                sdkRegistry: harness.sdkRegistry,
            })),
        };

        render(<MultisigCreate walletId={WALLET_ID} onBack={() => {}} />);
        await screen.findByLabelText(/Use one of this wallet's addresses/i);
        fireEvent.click(screen.getByRole('button', { name: /Add cosigner/i }));
        fireEvent.change(screen.getByLabelText(/Use one of this wallet's addresses/i), {
            target: { value: LOCAL_ADDRESS.id },
        });
        await waitFor(() => expect(screen.getAllByLabelText(/Master fingerprint/i)[0])
            .toHaveValue(LOCAL.fingerprint));
        await fillExternalRows();
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        expect(await screen.findByText(/2-of-3 SegWit multi-signature/i)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Confirm multisig' }));
        expect(await screen.findByText('Multisig configured')).toBeTruthy();

        const wallet = await harness.vault.wallets.get(WALLET_ID);
        expect(wallet.multisigs[0]).toMatchObject({
            threshold: 2,
            scheme: 'p2wsh-multisig',
        });
        expect(wallet.multisigs[0].cosigners.map((item) => item.pubkey))
            .toEqual([LOCAL.pubkey, BOB.pubkey, CAROL.pubkey]);

        cleanup();
        render(
            <MultisigCosignerShare
                walletId={WALLET_ID}
                addresses={[LOCAL_ADDRESS]}
                networkKind="testnet"
            />,
        );
        fireEvent.change(screen.getByLabelText('Address to share'), {
            target: { value: LOCAL_ADDRESS.id },
        });
        const shared = JSON.parse((await screen.findByLabelText('Cosigner share payload')).value);
        expect(shared).toEqual({
            type: 'xchain-multisig-cosigner',
            version: 1,
            network: 'testnet',
            address: LOCAL_ADDRESS.address,
            xpub: LOCAL.xpub,
            pubkey: LOCAL.pubkey,
            fingerprint: LOCAL.fingerprint,
            derivationPath: LOCAL.derivationPath,
        });

        const session = await startMultisigSigningSession({
            vault: harness.vault,
            walletId: WALLET_ID,
            chainId: CHAIN_ID,
            msgHash: MSG_HASH,
            psbtHex: PSBT_HEX,
            actionSummary: 'Send 0.01 BTC',
        });
        await contributeMultisigSignature({
            vault: harness.vault,
            sessionId: session.id,
            pubkey: LOCAL.pubkey,
            signatureHex: SIGNATURE,
        });
        messaging = {
            getSettings: vi.fn(async () => ({ walletMode: 'full' })),
            listMultisigSigningSessions: vi.fn(() => harness.vault.multisigSigningSessions.list()),
            getMultisigSigningSession: vi.fn(({ sessionId }) => (
                harness.vault.multisigSigningSessions.get(sessionId)
            )),
            contributeMultisigSignature: vi.fn((request) => contributeMultisigSignature({
                ...request,
                vault: harness.vault,
            })),
            finalizeMultisigSigningSession: vi.fn((request) => finalizeMultisigSigningSession({
                ...request,
                vault: harness.vault,
                sdkRegistry: harness.sdkRegistry,
            })),
            cancelMultisigSigningSession: vi.fn(),
            signMultisigLocally: vi.fn(),
        };

        cleanup();
        render(<MultisigSigningSession walletId={WALLET_ID} onBack={() => {}} />);
        const list = await screen.findByRole('list', { name: 'Multisig sessions' });
        fireEvent.click(within(list).getByRole('button'));
        await screen.findByLabelText('Multisig signing progress');
        fireEvent.click(screen.getByRole('button', { name: 'Import cosigner reply' }));
        const sessionRef = {
            scheme: session.scheme,
            threshold: session.threshold,
            cosignerPubkeys: session.cosignerPubkeys,
            msgHash: session.msgHash,
            psbtHex: session.psbtHex,
        };
        const reply = buildReplyEnvelope({
            kind: 'multisig-classical-reply',
            fingerprint: fingerprintSessionRef(sessionRef),
            contribution: { pubkey: BOB.pubkey, sig: SIGNATURE },
        });
        const chunks = encodeXcwChunks(encodeMultisigEnvelope(reply));
        fireEvent.change(screen.getByLabelText('Cosigner reply chunks'), {
            target: { value: chunks.join('\n') },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Submit chunks' }));
        await screen.findByText(/Signature from .* accepted/i);
        fireEvent.click(screen.getByRole('button', { name: 'Back to tracker' }));

        const finalize = await screen.findByRole('button', { name: 'Finalize transaction' });
        expect((await harness.vault.multisigSigningSessions.get(session.id)).signatures)
            .toHaveLength(2);
        fireEvent.click(finalize);
        const broadcast = await screen.findByRole('button', { name: 'Broadcast transaction' });
        expect(harness.finalizeMultisigPsbt).toHaveBeenCalledWith(PSBT_HEX);
        expect((await harness.vault.multisigSigningSessions.get(session.id))).toMatchObject({
            msgHash: MSG_HASH,
            psbtHex: PSBT_HEX,
            finalizedTxHex: '02000000000100',
            status: 'finalized',
        });

        fireEvent.click(broadcast);
        expect(await screen.findByText('Broadcast complete: broadcast-txid')).toBeTruthy();
        expect(harness.broadcastTx).toHaveBeenCalledWith('02000000000100');
        expect((await harness.vault.multisigSigningSessions.get(session.id))).toMatchObject({
            msgHash: MSG_HASH,
            psbtHex: PSBT_HEX,
            status: 'broadcast',
            txid: 'broadcast-txid',
        });
    });

    it('keeps the watcher view export-only while signatures are collected', async () => {
        const active = {
            schemaVersion: 1,
            id: 'watcher-session',
            walletId: WALLET_ID,
            chainId: CHAIN_ID,
            scheme: 'p2wsh-multisig',
            threshold: 2,
            cosignerPubkeys: [LOCAL.pubkey, BOB.pubkey, CAROL.pubkey],
            msgHash: MSG_HASH,
            psbtHex: PSBT_HEX,
            actionSummary: 'Send from watcher',
            nonces: [],
            aggNonce: null,
            partialSigs: [],
            aggregatedSchnorrSig: null,
            signatures: [],
            status: 'collecting-sigs',
            finalizedTxHex: null,
            txid: null,
            createdAt: '2026-10-13T12:00:00.000Z',
            updatedAt: '2026-10-13T12:00:00.000Z',
        };
        messaging = {
            getSettings: vi.fn(async () => ({ walletMode: 'watcher' })),
            listMultisigSigningSessions: vi.fn(async () => [active]),
            getMultisigSigningSession: vi.fn(async () => active),
            signMultisigLocally: vi.fn(),
        };

        render(<MultisigSigningSession walletId={WALLET_ID} onBack={() => {}} />);
        const list = await screen.findByRole('list', { name: 'Multisig sessions' });
        fireEvent.click(within(list).getByRole('button'));
        expect(await screen.findByText(/Watcher mode exports signing data/i)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Export signing request' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Sign with my key' })).toBeNull();
        expect(screen.queryByLabelText('Wallet password')).toBeNull();
        expect(messaging.signMultisigLocally).not.toHaveBeenCalled();
    });
});
