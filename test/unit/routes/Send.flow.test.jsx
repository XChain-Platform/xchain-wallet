// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { ExecuteContractForm } from '../../../packages/core/src/shared/routes/ExecuteContractForm.jsx';
import {
    Send,
    getUnusualSendWarnings,
} from '../../../packages/core/src/shared/routes/Send.jsx';
import { Receive } from '../../../packages/core/src/shared/routes/Receive.jsx';
import { sendToken as submitSendToken } from '../../../packages/core/src/flows/sendToken.js';
import { makeLedgerFactory } from '../../../packages/core/src/signerFactories/ledger.js';
import { makeTrezorFactory } from '../../../packages/core/src/signerFactories/trezor.js';
import { parseBip21Uri } from '../../../packages/core/src/uri/bip21.js';
import { parseXchainUri } from '../../../packages/core/src/uri/xchainUri.js';
import {
    deepLinkRoute,
    INVALID_DEEP_LINK_MESSAGE,
} from '../../../packages/desktop/renderer/deepLinkRoute.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { userEvent } from '../../helpers/userEvent.js';
import { decomposedFor, signedReplyFor } from '../../helpers/hwSignedReply.js';

const CHAIN_ID = 'bitcoin-mainnet';
const WALLET_ID = 'send-flow-wallet';
const FROM = 'bc1qsendersendersendersendersendersendersa';
const TO = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const SAVED_LOOKALIKE = 'bc1q111111111111111111111111abcdef';
const POISONED_TO = 'bc1qzzzzzzzzzzzzzzzzzzzzzzzzabcdef';
const LTC_TO = 'ltc1qxvenxvenxvenxvenxvenxvenxvenxvenwcpknh';
const AMOUNT = '0.01234567';
const PASSWORD = 'correct horse battery staple';
const PSBT = '70736274ff';
const TXID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff0';
// The device's reply, signed with a real test key so its signature verifies
// against the input the PSBT below spends from that key's address.
const DEVICE_DECOMPOSED = decomposedFor({
    inputs: [{ scriptType: 'p2wpkh', txid: 'a'.repeat(64), value: 1000, sequence: 0xffffffff }],
    outputs: [{ address: TO, scriptPubKeyHex: '0014' + 'cc'.repeat(20), value: 900 }],
});
const KEY_SCRIPT = DEVICE_DECOMPOSED.inputs[0].scriptPubKeyHex;
const DEVICE_TX = signedReplyFor(DEVICE_DECOMPOSED);
const PREV_TX = '0100000001' + '00'.repeat(32) + 'ffffffff00ffffffff01e8030000'
    + '0000000016' + KEY_SCRIPT + '00000000';

function composedSend({ amount = AMOUNT, networkFeeSats = 1234, encoding = 'P2SH' } = {}) {
    return {
        psbt: PSBT,
        encoding,
        actionString: `SEND|1|BTC|${amount}|${TO}`,
        version: 1,
        chainId: CHAIN_ID,
        networkFeeSats,
        decoded: {
            summary: `Send ${amount} BTC`,
            details: [
                { label: 'Token', value: 'BTC' },
                { label: 'Amount', value: amount },
                { label: 'Destination', value: TO },
            ],
            warnings: [],
        },
        simulation: {
            deltas: [{ tick: 'BTC', before: '1', after: '0.98764199' }],
            notes: [],
        },
    };
}

function mount({
    walletMode = 'full',
    sendResult = { txid: TXID },
    onBack = () => {},
    onDone,
    contacts = [],
    history = [],
    networkFeeSats = 1234,
    encoding,
    messagingOverrides = {},
    overrides = {},
    hardware = null,
    prefill = null,
} = {}) {
    const sourceAddress = hardware ? {
        id: 'address-1',
        address: FROM,
        publicKey: '02' + 'a'.repeat(64),
        derivationPath: "m/84'/0'/0'/0/0",
        source: hardware.kind,
        signerId: hardware.signer.id,
        signerLabel: hardware.signer.displayName,
    } : {
        id: 'address-1',
        address: FROM,
        publicKey: '02ab',
        derivationPath: "m/84'/0'/0'/0/0",
        source: 'hd',
    };
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN_ID]: [sourceAddress],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({
            [CHAIN_ID]: { id: 'address-1', address: FROM },
        }),
        getAddressBalances: vi.fn().mockResolvedValue({
            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
            tokens: [],
        }),
        getSettings: vi.fn().mockResolvedValue({
            walletMode,
            activeNetwork: 'mainnet',
            grace: { testSendThresholdSats: 0 },
            privacy: { formDraftTtlMs: 0 },
        }),
        updateSettings: vi.fn().mockResolvedValue({}),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: false }),
        listSigners: vi.fn().mockResolvedValue(hardware ? [{
            id: hardware.signer.id,
            vendor: hardware.kind,
            model: hardware.signer.model,
            firmwareVersion: '9.9.9',
        }] : []),
        listContacts: vi.fn().mockResolvedValue(contacts),
        saveContact: vi.fn().mockImplementation(async ({ input, record }) => record || {
            ...input,
            id: 'saved-contact',
            schemaVersion: 1,
            avatarSeed: input.entries[0].address,
            createdAt: '2026-10-13T00:00:00.000Z',
            updatedAt: '2026-10-13T00:00:00.000Z',
        }),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
        getAddressHistory: vi.fn().mockResolvedValue(history),
        gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
        composeForConfirm: vi.fn().mockImplementation(async (request) => composedSend({
            amount: request.amount,
            networkFeeSats,
            encoding,
        })),
        sendToken: vi.fn().mockImplementation(async (request) => {
            if (typeof sendResult === 'function') return sendResult(request);
            if (sendResult instanceof Error) throw sendResult;
            return sendResult;
        }),
        sendAssetHw: vi.fn().mockImplementation(async (request) => {
            if (!hardware) throw new Error('No hardware signer configured');
            const signed = await hardware.signer.signPsbt({
                psbtHex: request.prebuiltPsbt.psbtHex,
                chainId: request.chainId,
                signingPaths: [{ inputIndex: 0, path: request.from.derivationPath }],
            });
            return { txid: signed.txid };
        }),
        buildSendPsbtRequest: vi.fn().mockResolvedValue({
            psbtHex: PSBT,
            encoding: 'P2SH',
            fromAddress: FROM,
            chainId: CHAIN_ID,
        }),
        ...messagingOverrides,
        ...overrides,
    };
    if (hardware) {
        base.getSignerStatus.mockImplementation(({ chainId }) =>
            hardware.signer.getStatus({ chainId }));
    }
    // Send's supporting lookups are not part of this flow contract. Empty
    // host responses keep the test focused on the compose and submit messages.
    const messaging = new Proxy(base, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            target[prop] = stub;
            return stub;
        },
    });

    const view = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ToastHost>
                <Send walletId={WALLET_ID} onBack={onBack} onDone={onDone} prefill={prefill} />
            </ToastHost>
        </MessagingProvider>,
    );
    messaging.unmountView = view.unmount;
    return messaging;
}

function sdkBroadcastHarness(broadcastAnswer) {
    const pending = new Map();
    const pendingTxs = {
        put: vi.fn(async (record) => pending.set(record.id, structuredClone(record))),
        list: vi.fn(async () => Array.from(pending.values()).map((record) => structuredClone(record))),
    };
    const broadcastTx = vi.fn(async () => {
        if (broadcastAnswer instanceof Error) throw broadcastAnswer;
        return broadcastAnswer;
    });
    const signPsbt = vi.fn(async ({ psbtHex }) => ({
        signedPsbtHex: `signed:${psbtHex}`,
        txHex: '0200000001signed',
        txid: TXID,
    }));
    const queued = [];
    const vault = {
        pendingTxs,
        settings: { get: vi.fn(async () => ({})), put: vi.fn(async () => {}) },
    };
    const chainRegistry = {
        get: () => ({ id: CHAIN_ID, coin: 'bitcoin', networkKind: 'mainnet' }),
    };
    const sdkRegistry = {
        get: () => ({
            encoder: { broadcastTx },
            wallet: { decomposePsbt: () => ({ inputs: [{}], outputs: [] }) },
        }),
    };
    const send = (request) => submitSendToken({
        ...request,
        vault,
        chainRegistry,
        sdkRegistry,
        signer: { kind: 'software', signPsbt },
        onBroadcastFailure: async (entry) => {
            queued.push(structuredClone(entry));
            return true;
        },
    });
    return { send, signPsbt, broadcastTx, pendingTxs, queued };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function appInfoBytes(name = 'Bitcoin', version = '2.2.1') {
    const ascii = (value) => [...value].map((char) => char.charCodeAt(0));
    return Uint8Array.from([
        1,
        name.length, ...ascii(name),
        version.length, ...ascii(version),
        1, 0,
        0x90, 0x00,
    ]);
}

function signingSdkRegistry() {
    const wallet = {
        decomposePsbt: vi.fn().mockReturnValue({
            inputs: [{
                scriptType: 'p2wpkh',
                prevTxHash: 'a'.repeat(64),
                prevTxIndex: 0,
                value: 1000,
                sequence: 0xffffffff,
                witnessUtxoScriptHex: KEY_SCRIPT,
                nonWitnessUtxoHex: PREV_TX,
                sighashType: null,
                redeemScriptHex: null,
            }],
            outputs: [{
                address: TO,
                scriptPubKeyHex: '0014' + 'cc'.repeat(20),
                scriptType: 'p2wpkh',
                value: 900,
            }],
            locktime: 0,
            txVersion: 2,
        }),
        txidOf: vi.fn().mockReturnValue(TXID),
    };
    return { get: vi.fn().mockReturnValue({ wallet }) };
}

async function pairMockHardware(kind, signBehavior = 'approve') {
    const sdkRegistry = signingSdkRegistry();
    if (kind === 'ledger') {
        const transport = {
            deviceModel: { id: 'nanoX' },
            send: vi.fn().mockResolvedValue(appInfoBytes()),
        };
        const app = {
            getWalletPublicKey: vi.fn().mockResolvedValue({
                publicKey: '02' + 'a'.repeat(64),
                bitcoinAddress: FROM,
                chainCode: 'c'.repeat(64),
            }),
            splitTransaction: vi.fn().mockReturnValue({}),
            createPaymentTransaction: signBehavior === 'approve'
                ? vi.fn().mockResolvedValue(DEVICE_TX)
                : vi.fn(),
            signMessage: vi.fn(),
        };
        if (signBehavior === 'reject') {
            app.createPaymentTransaction.mockRejectedValue(
                Object.assign(new Error('Denied by user'), { statusCode: 0x6985 }),
            );
        } else if (typeof signBehavior === 'function') {
            app.createPaymentTransaction.mockImplementation(signBehavior);
        }
        const getTransport = vi.fn().mockResolvedValue(transport);
        const pair = makeLedgerFactory({
            getTransport,
            getAppClass: vi.fn().mockResolvedValue(function Btc() { return app; }),
            sdkRegistry,
        });
        const result = await pair();
        return { ...result, kind, transport, device: app, getTransport };
    }

    const connect = {
        getFeatures: vi.fn().mockResolvedValue({
            success: true,
            payload: {
                device_id: 'TREZOR_DEVICE',
                internal_model: 'T2T1',
                major_version: 2,
                minor_version: 8,
                patch_version: 1,
                label: 'Test Trezor',
            },
        }),
        getAddress: vi.fn().mockResolvedValue({ success: true, payload: { address: FROM } }),
        getPublicKey: vi.fn().mockResolvedValue({
            success: true,
            payload: {
                publicKey: '02' + 'a'.repeat(64),
                chainCode: 'c'.repeat(64),
                fingerprint: '12345678',
            },
        }),
        signTransaction: signBehavior === 'approve'
            ? vi.fn().mockResolvedValue({ success: true, payload: { serializedTx: DEVICE_TX } })
            : vi.fn(),
        signMessage: vi.fn(),
    };
    if (signBehavior === 'reject') {
        connect.signTransaction.mockResolvedValue({
            success: false,
            payload: { code: 'Failure_ActionCancelled', error: 'Action cancelled' },
        });
    } else if (typeof signBehavior === 'function') {
        connect.signTransaction.mockImplementation(signBehavior);
    }
    const getConnect = vi.fn().mockResolvedValue(connect);
    const pair = makeTrezorFactory({ getConnect, sdkRegistry });
    const result = await pair();
    return { ...result, kind, transport: connect, device: connect, getConnect };
}

async function approveHardwareSend(messaging) {
    await fillSendForm();
    await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledOnce());
    await screen.findByTestId('confirm-modal');
    await waitFor(() => expect(document.querySelector('[data-status="available"]')).not.toBeNull());
    const confirmation = screen.queryByRole('checkbox');
    if (confirmation) fireEvent.click(confirmation);
    const approve = screen.getByTestId('confirm-approve');
    await waitFor(() => expect(approve).toBeEnabled());
    fireEvent.click(approve);
}

async function fillSendForm(sendAmount = AMOUNT) {
    fireEvent.change(await screen.findByLabelText(/^To$/), { target: { value: TO } });
    fireEvent.change(await screen.findByLabelText(/^Amount \(/), { target: { value: sendAmount } });
    fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
}

async function openPasswordConfirm(messaging) {
    await fillSendForm();
    await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
    return screen.findByTestId('confirm-modal');
}

async function approveWithPassword(messaging) {
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
    const approve = screen.getByTestId('confirm-approve');
    await waitFor(() => expect(approve).toBeEnabled());
    fireEvent.click(approve);
    await waitFor(() => expect(messaging.sendToken).toHaveBeenCalledTimes(1));
}

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('Send flow with mocked messaging', () => {
    it('does not show SDK text when loading send or receive addresses fails', async () => {
        const sdkFailure = Object.assign(
            new Error('SDKHubError: request failed with status code 503\n    at load.js:4:2'),
            { name: 'SDKHubError', code: 'HUB_UNAVAILABLE' },
        );
        mount({
            messagingOverrides: {
                getAddressesByChain: vi.fn().mockRejectedValue(sdkFailure),
            },
        });

        expect(await screen.findByRole('alert')).toHaveTextContent(
            "Couldn't load addresses. Check your connection and try again.",
        );
        expect(document.body).not.toHaveTextContent('SDKHubError');
        expect(document.body).not.toHaveTextContent('status code 503');

        cleanup();
        render(
            <MessagingProvider shell="web" messaging={{
                getAddressesByChain: vi.fn().mockRejectedValue(sdkFailure),
                getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'mainnet' }),
            }}>
                <Receive walletId={WALLET_ID} />
            </MessagingProvider>,
        );

        expect(await screen.findByRole('alert')).toHaveTextContent(
            "Couldn't load addresses. Check your connection and try again.",
        );
        expect(document.body).not.toHaveTextContent('SDKHubError');
        expect(document.body).not.toHaveTextContent('status code 503');
    });

    it('replaces an SDK send failure and its raw details with actionable copy', async () => {
        const sdkFailure = Object.assign(
            new Error('SDK wallet exploded\n    at signer.js:9:3'),
            { name: 'SDKWalletError', code: 'SIGN_FAILED' },
        );
        const messaging = mount({ sendResult: sdkFailure });
        await openPasswordConfirm(messaging);
        await approveWithPassword(messaging);

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(
            'The wallet could not prepare or sign this request. Check the wallet details and try again.',
        );
        expect(alert).not.toHaveTextContent('SDK wallet exploded');
        expect(alert).not.toHaveTextContent('signer.js');
        expect(screen.queryByText(/technical details/i)).toBeNull();
    });

    it('bounds and type-checks URI fields while ignoring unknown optional parameters', () => {
        const valid = parseXchainUri(
            `xchain:BTC/send?to=${TO}&amount=1.25&tick=BTC&label=Invoice&message=Lunch&unknown=drop-me`,
            { chainRegistry: defaultRegistry() },
        );
        expect(valid).toMatchObject({
            kind: 'send',
            amount: '1.25',
            tick: 'BTC',
            label: 'Invoice',
            message: 'Lunch',
        });
        expect(valid.params).not.toHaveProperty('unknown');
        expect(deepLinkRoute(
            `xchain:BTC/send?to=${TO}&amount=1.25&tick=BTC&message=Invoice&unknown=drop-me`,
            defaultRegistry(),
        )).toMatchObject({
            view: 'send',
            sendPrefill: { requestMessage: 'Invoice', memo: undefined },
        });

        expect(() => parseBip21Uri(`bitcoin:${TO}?label=${'a'.repeat(251)}`)).toThrow(/limit/);
        for (const uri of [
            `xchain:BTC/send?to=${TO}&tick=${'T'.repeat(251)}`,
            `xchain:BTC/execute?contract=1&method=${'m'.repeat(65)}`,
            `xchain:BTC/execute?contract=1&method=pay&params=a||b`,
            `xchain:BTC/execute?contract=1&method=pay&params=${'a'.repeat(1025)}`,
        ]) {
            expect(parseXchainUri(uri, { chainRegistry: defaultRegistry() }).kind, uri).toBe('unknown');
        }
        expect(deepLinkRoute(
            'xchain:BTC/execute?contract=not-a-number&method=pay',
            defaultRegistry(),
        )).toEqual({ view: 'deep-link-error', message: INVALID_DEEP_LINK_MESSAGE });
        expect(deepLinkRoute(
            `xchain:BTC/send?to=${TO}&amount=1e9`,
            defaultRegistry(),
        )).toEqual({ view: 'deep-link-error', message: INVALID_DEEP_LINK_MESSAGE });
        expect(deepLinkRoute(
            `xchain:BTC/send?to=${TO}&tick=${encodeURIComponent('NOT A TOKEN')}`,
            defaultRegistry(),
        )).toEqual({ view: 'deep-link-error', message: INVALID_DEEP_LINK_MESSAGE });
    });

    it('shows deep-link text as text on the compose form and requires review before action', async () => {
        const registry = defaultRegistry();
        const message = '<img src=x onerror="globalThis.deepLinkRan=true">';
        const route = deepLinkRoute(
            `bitcoin:${TO}?amount=${AMOUNT}&label=ignored&message=${encodeURIComponent(message)}&unknown=drop-me`,
            registry,
        );

        expect(route).toEqual({
            view: 'send',
            sendPrefill: {
                address: TO,
                amount: AMOUNT,
                tick: 'BTC',
                chainId: CHAIN_ID,
                memo: message,
            },
        });
        const messaging = mount({ prefill: route.sendPrefill });

        expect(await screen.findByRole('form', { name: 'Send' })).toBeInTheDocument();
        expect(screen.getByLabelText('Token')).toHaveValue('BTC');
        expect(screen.getByLabelText(/^Amount \(/)).toHaveValue(AMOUNT);
        expect(screen.getByTestId('payment-request-message')).toHaveTextContent(message);
        expect(document.querySelector('img[src="x"]')).toBeNull();
        expect(globalThis.deepLinkRan).toBeUndefined();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
        expect(messaging.sendToken).not.toHaveBeenCalled();

        const pastedMessage = '<svg onload="globalThis.pastedUriRan=true">';
        fireEvent.paste(screen.getByLabelText(/^To$/), {
            clipboardData: {
                getData: () => `bitcoin:${TO}?amount=${AMOUNT}&message=${encodeURIComponent(pastedMessage)}`,
            },
        });
        expect(screen.getByTestId('payment-request-message')).toHaveTextContent(pastedMessage);
        expect(document.querySelector('svg[onload]')).toBeNull();
        expect(globalThis.pastedUriRan).toBeUndefined();

        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        expect(await screen.findByTestId('confirm-modal')).toBeInTheDocument();
        expect(messaging.sendToken).not.toHaveBeenCalled();
    });

    it('rejects oversized deep links and only routes valid contract calls to their form', () => {
        const registry = defaultRegistry();
        expect(deepLinkRoute(
            `bitcoin:${TO}?message=${'x'.repeat(251)}`,
            registry,
        )).toEqual({ view: 'deep-link-error', message: INVALID_DEEP_LINK_MESSAGE });

        const contract = deepLinkRoute(
            'xchain:BTC/execute?contract=12&method=pay&params=alice%7C1&unknown=drop-me',
            registry,
        );
        expect(contract).toEqual({
            view: 'contract-execute',
            contractRef: { chainId: CHAIN_ID, contractActionIndex: '12' },
            executePrefill: { method: 'pay', paramsText: 'alice|1' },
        });
        expect(contract).not.toHaveProperty('action');
        expect(contract).not.toHaveProperty('submit');
        expect(contract.view).not.toMatch(/review|confirm|sign|submit/);
    });

    it('renders contract arguments as plain text and waits for review before building', async () => {
        const registry = defaultRegistry();
        const argument = '<img src=x onerror="globalThis.contractLinkRan=true">';
        const route = deepLinkRoute(
            `xchain:BTC/execute?contract=12&method=pay&params=${encodeURIComponent(argument)}`,
            registry,
        );
        const base = {
            getAddressesByChain: vi.fn().mockResolvedValue({
                [CHAIN_ID]: [{
                    id: 'address-1',
                    address: FROM,
                    publicKey: '02ab',
                    derivationPath: "m/84'/0'/0'/0/0",
                    source: 'hd',
                }],
            }),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }),
            signerReady: vi.fn().mockResolvedValue({ ready: false }),
            getContractByActionIndex: vi.fn().mockResolvedValue(null),
            buildActionPsbtRequest: vi.fn().mockResolvedValue({ psbtHex: PSBT }),
        };
        const messaging = new Proxy(base, {
            get(target, property) {
                if (property in target) return target[property];
                const stub = vi.fn().mockResolvedValue(null);
                target[property] = stub;
                return stub;
            },
        });

        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <ExecuteContractForm
                    walletId={WALLET_ID}
                    chainId={route.contractRef.chainId}
                    contractActionIndex={route.contractRef.contractActionIndex}
                    initialMethod={route.executePrefill.method}
                    initialParamsText={route.executePrefill.paramsText}
                    onBack={() => {}}
                />
            </MessagingProvider>,
        );

        expect(await screen.findByLabelText('Method')).toHaveValue('pay');
        expect(screen.getByLabelText('Arguments (optional)')).toHaveValue(argument);
        expect(document.querySelector('img[src="x"]')).toBeNull();
        expect(globalThis.contractLinkRan).toBeUndefined();
        expect(messaging.buildActionPsbtRequest).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
        const review = await screen.findByRole('form', { name: 'Review contract call' });
        expect(review).toHaveTextContent(argument);
        expect(document.querySelector('img[src="x"]')).toBeNull();
        expect(messaging.buildActionPsbtRequest).not.toHaveBeenCalled();
    });

    it('keeps field labels ahead of their values in DOM reading order', async () => {
        mount();

        const from = await screen.findByLabelText('From');
        const fromLabel = document.querySelector(`label[for="${from.id}"]`);
        const token = screen.getByLabelText('Token');
        const tokenLabel = document.querySelector(`label[for="${token.id}"]`);

        expect(fromLabel.compareDocumentPosition(from) & Node.DOCUMENT_POSITION_FOLLOWING)
            .toBeTruthy();
        expect(tokenLabel.compareDocumentPosition(token) & Node.DOCUMENT_POSITION_FOLLOWING)
            .toBeTruthy();
    });

    it('uses strict exact-decimal thresholds for unusual-send warnings', () => {
        const boundary = getUnusualSendWarnings({
            sendTotals: [{ tick: 'BTC', amount: '0.9' }],
            balances: [{ tick: 'BTC', amount: '1' }],
            feeAmount: '0.09',
            nativeTicker: 'BTC',
            isNativeSend: true,
        });
        expect(boundary).toEqual([]);

        expect(getUnusualSendWarnings({
            sendTotals: [{ tick: 'BTC', amount: '0.900000000000000001' }],
            balances: [{ tick: 'BTC', amount: '1' }],
            feeAmount: '0.090000000000000001',
            nativeTicker: 'BTC',
            isNativeSend: true,
        })).toEqual([
            'This sends more than 90% of your BTC balance.',
            'The network fee is more than 10% of the BTC amount you are sending.',
        ]);
    });

    it('shows unusual-send warnings without blocking approval', async () => {
        const messaging = mount({ networkFeeSats: 9_100_001 });
        await fillSendForm('0.91');
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));

        const warnings = await screen.findByTestId('send-unusual-warnings');
        expect(warnings).toHaveTextContent('This sends more than 90% of your BTC balance.');
        expect(warnings).toHaveTextContent(
            'The network fee is more than 10% of the BTC amount you are sending.',
        );

        await approveWithPassword(messaging);
        expect(messaging.sendToken).toHaveBeenCalledWith(expect.objectContaining({ amount: '0.91' }));
    });

    it('tabs through payment fields and reviews only a valid Enter submission', async () => {
        const user = userEvent.setup();
        const messaging = mount();
        await screen.findByLabelText('From');
        const destination = await screen.findByLabelText(/^To$/);
        destination.focus();

        await user.tab();
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open address book' }));
        await user.tab();
        expect(document.activeElement).toBe(screen.getByLabelText('Token'));
        await user.tab();
        expect(document.activeElement).toBe(screen.getByLabelText(/^Amount \(/));
        await user.keyboard('{Enter}');

        expect(await screen.findByRole('alert')).toHaveTextContent('Enter a recipient address.');
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();

        fireEvent.change(destination, { target: { value: TO } });
        const amount = screen.getByLabelText(/^Amount \(/);
        fireEvent.change(amount, { target: { value: AMOUNT } });
        amount.focus();
        await user.keyboard('{Enter}');

        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        expect(await screen.findByTestId('confirm-modal')).toBeInTheDocument();
    });

    it('cleans a pasted recipient, shows both ends, and signs the full cleaned address', async () => {
        const messaging = mount();
        const toField = await screen.findByLabelText(/^To$/);
        fireEvent.paste(toField, {
            clipboardData: { getData: () => ` \u200B${TO}\uFEFF ` },
        });

        expect(toField).toHaveValue(TO);
        expect(screen.getByText('Check pasted recipient')).toBeInTheDocument();
        expect(screen.getByLabelText(TO)).toHaveTextContent('bc1qw5…v8f3t4');

        fireEvent.change(screen.getByLabelText(/^Amount \(/), { target: { value: AMOUNT } });
        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledWith(
            expect.objectContaining({ to: TO }),
        ));
        await screen.findByTestId('confirm-modal');
        await approveWithPassword(messaging);
        expect(messaging.sendToken).toHaveBeenCalledWith(expect.objectContaining({ to: TO }));
    });

    it('ignores an older clipboard check after a newer recipient is pasted', async () => {
        const firstRead = deferred();
        const secondRead = deferred();
        const readText = vi.fn()
            .mockReturnValueOnce(firstRead.promise)
            .mockReturnValueOnce(secondRead.promise);
        vi.stubGlobal('navigator', { ...navigator, clipboard: { readText } });
        mount();
        const toField = await screen.findByLabelText(/^To$/);

        fireEvent.paste(toField, { clipboardData: { getData: () => TO } });
        await waitFor(() => expect(readText).toHaveBeenCalledTimes(1));
        fireEvent.paste(toField, { clipboardData: { getData: () => FROM } });
        await waitFor(() => expect(readText).toHaveBeenCalledTimes(2));
        secondRead.resolve(FROM);
        await waitFor(() => expect(toField).toHaveValue(FROM));
        firstRead.resolve('clipboard malware replacement');
        await Promise.resolve();
        await Promise.resolve();

        expect(screen.queryByText(/Clipboard changed after paste/i)).not.toBeInTheDocument();
    });

    it('discards a key-recovery result after the selected asset changes', async () => {
        const scan = deferred();
        const readiness = vi.fn(async ({ tick }) => (
            tick === 'PEPE'
                ? { state: 'blocked', groups: [{ keyHash: 'aa', haveKey: false }] }
                : { state: 'ungated', groups: [] }
        ));
        mount({
            overrides: {
                gatedSendReadiness: readiness,
                gatedContentScan: vi.fn(() => scan.promise),
            },
        });
        await screen.findByLabelText(/^To$/);
        fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'PEPE' } });
        const password = await screen.findByLabelText('Wallet password', {}, { timeout: 1500 });
        fireEvent.change(password, { target: { value: PASSWORD } });
        fireEvent.click(screen.getByRole('button', { name: 'Recover keys' }));

        fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'BTC' } });
        expect(screen.queryByLabelText('Wallet password')).not.toBeInTheDocument();
        scan.resolve({ recoveredKeyHashes: ['aa'] });
        await Promise.resolve();
        await Promise.resolve();

        expect(screen.queryByText(/wallet holds none of its unlock keys/i)).not.toBeInTheDocument();
    });

    it('plainly refuses a pasted address from another network', async () => {
        const messaging = mount();
        const toField = await screen.findByLabelText(/^To$/);
        fireEvent.paste(toField, {
            clipboardData: { getData: () => LTC_TO },
        });

        expect(toField).toHaveValue(LTC_TO);
        expect(await screen.findByText(
            'This looks like a Litecoin address, not a Bitcoin address.',
        )).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText(/^Amount \(/), { target: { value: AMOUNT } });
        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('accepts optional BIP21 fields while refusing unsupported required fields', async () => {
        mount();
        const toField = await screen.findByLabelText(/^To$/);

        fireEvent.paste(toField, {
            clipboardData: {
                getData: () => `BITCOIN:${TO}?AMOUNT=0.25&LABEL=Coffee%20shop&EXTRA=kept`,
            },
        });

        expect(toField).toHaveValue(TO);
        expect(screen.getByLabelText(/^Amount \(/)).toHaveValue('0.25');
        fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'XCP' } });
        expect(screen.getByLabelText('Memo (optional)')).toHaveValue('Coffee shop');

        fireEvent.change(toField, { target: { value: '' } });
        fireEvent.paste(toField, {
            clipboardData: { getData: () => `bitcoin:${TO}?req-extra=needed` },
        });

        expect(toField).toHaveValue('');
        expect(await screen.findByText(
            'This payment request requires a feature this wallet does not support.',
        )).toBeInTheDocument();
    });

    it('keeps a refused payment request note after the field loses focus', async () => {
        mount();
        const toField = await screen.findByLabelText(/^To$/);

        fireEvent.paste(toField, {
            clipboardData: { getData: () => `bitcoin:${TO}?req-extra=needed` },
        });
        fireEvent.blur(toField);

        expect(await screen.findByText(
            'This payment request requires a feature this wallet does not support.',
        )).toBeInTheDocument();
    });

    it('does not say the amount was cleared when the pasted link supplies one', async () => {
        mount();
        const toField = await screen.findByLabelText(/^To$/);

        fireEvent.paste(toField, {
            clipboardData: { getData: () => `bitcoin:${TO}?amount=0.25&tick=PEPE` },
        });

        expect(screen.getByLabelText(/^Amount \(/)).toHaveValue('0.25');
        expect(screen.queryByText(/amount was cleared/i)).toBeNull();
    });

    it('drops the previous link message when the next pasted link has none', async () => {
        mount();
        const toField = await screen.findByLabelText(/^To$/);

        fireEvent.paste(toField, {
            clipboardData: { getData: () => `bitcoin:${TO}?amount=0.25&message=Rent` },
        });
        fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'XCP' } });
        expect(screen.getByLabelText('Memo (optional)')).toHaveValue('Rent');

        fireEvent.paste(toField, {
            clipboardData: { getData: () => `bitcoin:${TO}?amount=0.5` },
        });
        expect(screen.getByLabelText('Memo (optional)')).toHaveValue('');
        expect(screen.queryByTestId('payment-request-message')).toBeNull();
    });

    it.each([
        ['malformed', 'bitcoin', TO, '../../evil'],
        ['unsupported', 'bitcoin', TO, 'monero-mainnet'],
        ['not held by this wallet', 'litecoin', LTC_TO, 'litecoin-mainnet'],
    ])('refuses a BIP21 request for a %s network', async (
        _label,
        scheme,
        address,
        requestChainId,
    ) => {
        mount();
        const toField = await screen.findByLabelText(/^To$/);

        fireEvent.paste(toField, {
            clipboardData: {
                getData: () => `${scheme}:${address}?chain=${encodeURIComponent(requestChainId)}`,
            },
        });

        expect(toField).toHaveValue('');
        expect(await screen.findByText(
            'This payment request names a network this wallet cannot use.',
        )).toBeInTheDocument();
    });

    it('validates a typed recipient on blur without interrupting typing', async () => {
        mount();
        const toField = await screen.findByLabelText(/^To$/);

        fireEvent.change(toField, { target: { value: 'abc' } });
        expect(screen.queryByText(/This address has a typo/i)).toBeNull();

        fireEvent.blur(toField);
        expect(await screen.findByText(/This is not a valid address/i)).toBeInTheDocument();

        fireEvent.change(toField, { target: { value: TO } });
        expect(screen.queryByText(/This address has a typo/i)).toBeNull();
    });

    it('validates an invalid recipient immediately on paste', async () => {
        mount();
        const toField = await screen.findByLabelText(/^To$/);

        fireEvent.paste(toField, {
            clipboardData: { getData: () => 'abc' },
        });

        expect(toField).toHaveValue('abc');
        expect(await screen.findByText(/This is not a valid address/i)).toBeInTheDocument();
    });

    it('keeps a checksum typo on the form with the shared address copy', async () => {
        const messaging = mount();
        const toField = await screen.findByLabelText(/^To$/);

        fireEvent.change(toField, {
            target: { value: 'bc1qtestrecipient00000000000000000000000000' },
        });
        fireEvent.change(screen.getByLabelText(/^Amount \(/), { target: { value: '0.01' } });
        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));

        await waitFor(() => expect(document.getElementById('send-destination-error')).toHaveTextContent(
            'This address has a typo. Check it and try again.',
        ));
        expect(screen.queryByTestId('confirm-modal')).not.toBeInTheDocument();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('fills a same-chain contact and refuses a wrong-chain contact', async () => {
        const doge = 'DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L';
        const messaging = mount({
            contacts: [
                {
                    id: 'alice',
                    name: 'Alice',
                    entries: [{ chain: 'bitcoin', address: TO, label: 'Main' }],
                },
                {
                    id: 'shibe',
                    name: 'Shibe',
                    entries: [{ chain: 'dogecoin', address: doge, label: 'Tips' }],
                },
            ],
        });

        const to = await screen.findByLabelText(/^To$/);
        await waitFor(() => expect(messaging.listContacts).toHaveBeenCalledTimes(1));
        fireEvent.click(screen.getByRole('button', { name: 'Open address book' }));
        fireEvent.click(await screen.findByRole('button', { name: /Shibe/ }));

        expect(await screen.findByLabelText(/^To$/)).toHaveValue('');
        expect(screen.getByRole('alert')).toHaveTextContent(
            'This looks like a Dogecoin address, not a Bitcoin address.',
        );
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Open address book' }));
        fireEvent.click(await screen.findByRole('button', { name: /Alice/ }));

        expect(await screen.findByRole('combobox', { name: /^To/ })).toHaveValue(TO);
        expect(screen.queryByText(/not a Bitcoin address/)).toBeNull();
    });

    it('refreshes contacts edited while Send stays open', async () => {
        const oldAddress = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';
        const messaging = mount({
            contacts: [{
                id: 'alice',
                name: 'Alice',
                entries: [{ chain: 'bitcoin', address: oldAddress, label: 'Main' }],
            }],
        });
        await screen.findByLabelText(/^To$/);
        await waitFor(() => expect(messaging.listContacts).toHaveBeenCalledTimes(1));
        fireEvent.click(screen.getByRole('button', { name: 'Open address book' }));
        expect(await screen.findByText('Alice')).toBeInTheDocument();
        expect(screen.getByText(oldAddress)).toBeInTheDocument();

        messaging.listContacts.mockResolvedValueOnce([{
            id: 'alice',
            name: 'Alice updated',
            entries: [{ chain: 'bitcoin', address: TO, label: 'Main' }],
        }]);
        fireEvent.focus(window);

        expect(await screen.findByText('Alice updated')).toBeInTheDocument();
        expect(screen.queryByText(oldAddress)).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /Alice updated/ }));
        expect(await screen.findByRole('combobox', { name: /^To/ })).toHaveValue(TO);
    });

    it('warns when contacts cannot be refreshed before picking', async () => {
        const messaging = mount();
        await screen.findByLabelText(/^To$/);
        await waitFor(() => expect(messaging.listContacts).toHaveBeenCalledTimes(1));
        messaging.listContacts.mockRejectedValueOnce(new Error('vault unavailable'));

        fireEvent.click(screen.getByRole('button', { name: 'Open address book' }));

        expect(await screen.findByText(
            "Couldn't refresh contacts. Saved addresses may be out of date.",
        )).toBeInTheDocument();
        expect(await screen.findByText('No contacts yet')).toBeInTheDocument();
    });

    it('shows recent recipients from a wrapped history response', async () => {
        const recent = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';
        mount({
            history: { data: [{ action: 'SEND', destination: recent, timestamp: 123 }] },
        });

        const to = await screen.findByLabelText(/^To$/);
        fireEvent.focus(to);
        await waitFor(() => expect(screen.getByText('Previously sent')).toBeInTheDocument());
        fireEvent.change(to, { target: { value: '1BvB' } });
        fireEvent.mouseDown(screen.getByRole('option', { name: /Recent/ }));

        expect(to).toHaveValue(recent);
    });

    it.each([
        {
            source: 'a contact',
            contacts: [{
                id: 'alice',
                name: 'Alice',
                entries: [{ chain: 'bitcoin', address: SAVED_LOOKALIKE }],
            }],
            history: [],
            sourceLabel: 'contact "Alice"',
        },
        {
            source: 'send history',
            contacts: [],
            history: [{ action: 'SEND', destination: SAVED_LOOKALIKE, timestamp: 123 }],
            sourceLabel: 'an address you have sent to before',
        },
    ])('warns before review when a recipient copies both ends of $source', async ({
        contacts,
        history,
        sourceLabel,
    }) => {
        const messaging = mount({ contacts, history });
        const to = await screen.findByLabelText(/^To$/);
        fireEvent.change(to, { target: { value: POISONED_TO } });

        const warning = await screen.findByRole('alert');
        expect(warning).toHaveTextContent(sourceLabel);
        expect(warning).toHaveTextContent(SAVED_LOOKALIKE);
        expect(screen.getByRole('form', { name: 'Send' })).toBeInTheDocument();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('rejects an iOS-swiped review without retaining its partial password', async () => {
        const onBack = vi.fn();
        const messaging = mount({ onBack });
        await openPasswordConfirm(messaging);
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'partial secret' } });

        act(() => window.dispatchEvent(new Event('xchain:native-edge-back')));

        await waitFor(() => expect(screen.getByRole('form', { name: 'Send' })).toBeInTheDocument());
        expect(onBack).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(2));
        expect(await screen.findByLabelText('Password')).toHaveValue('');
    });

    it('reviews every payment field, signs with the password, and shows the txid', async () => {
        const onBack = vi.fn();
        const onDone = vi.fn();
        const messaging = mount({ onBack, onDone });
        const confirm = await openPasswordConfirm(messaging);

        expect(messaging.composeForConfirm).toHaveBeenCalledWith(expect.objectContaining({
            walletId: WALLET_ID,
            chainId: CHAIN_ID,
            from: expect.objectContaining({ address: FROM, addressId: 'address-1' }),
            to: TO,
            tick: 'BTC',
            amount: AMOUNT,
        }));
        expect(within(confirm).getByTestId('confirm-chain-badge')).toHaveTextContent('Bitcoin');
        expect(within(confirm).getByTestId('confirm-source')).toHaveTextContent(FROM);
        expect(within(confirm).getByTestId('action-intent')).toHaveTextContent(`Send ${AMOUNT} BTC`);
        expect(within(confirm).getByTestId('action-intent')).toHaveTextContent(`TokenBTC`);
        expect(within(confirm).getByTestId('action-intent')).toHaveTextContent(`Amount${AMOUNT}`);
        expect(within(confirm).getByTestId('action-intent')).toHaveTextContent(`To${TO}`);
        expect(within(confirm).getByTestId('confirm-fee')).toHaveTextContent('Network fee: 0.00001234 BTC');
        expect(within(confirm).getByLabelText('Password')).toBeInTheDocument();

        await approveWithPassword(messaging);

        expect(messaging.sendToken).toHaveBeenCalledWith(expect.objectContaining({
            walletId: WALLET_ID,
            chainId: CHAIN_ID,
            to: TO,
            tick: 'BTC',
            amount: AMOUNT,
            password: PASSWORD,
            prebuiltPsbt: expect.objectContaining({ psbtHex: PSBT }),
        }));
        expect(await screen.findByRole('heading', { name: 'Broadcast pending' })).toBeInTheDocument();
        expect(screen.getByLabelText(TXID)).toBeInTheDocument();
        expect(screen.getByText(`${AMOUNT} BTC`)).toBeInTheDocument();
        // The ToastHost notifications viewport is its own status region, so the
        // success screen's announcement is looked up inside the screen's main.
        const announcement = within(screen.getByRole('main')).getByRole('status');
        expect(announcement).toHaveAttribute('aria-live', 'polite');
        expect(announcement).toHaveAttribute('aria-atomic', 'true');
        expect(announcement).toHaveTextContent(/network accepted your transaction/i);
        expect(within(screen.getByRole('main')).getAllByRole('status')).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Copy transaction ID' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /View in block explorer/i })).toHaveAttribute(
            'href',
            `https://explorer.xchain.io/BTC/tx/${TXID}`,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Done' }));
        expect(onDone).toHaveBeenCalledTimes(1);
        expect(onBack).not.toHaveBeenCalled();
    });

    it('launches only one confirmation when the compose form submits twice', async () => {
        const compose = deferred();
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const messaging = mount({
            overrides: { composeForConfirm: vi.fn(() => compose.promise) },
        });
        fireEvent.change(await screen.findByLabelText(/^To$/), { target: { value: TO } });
        fireEvent.change(screen.getByLabelText(/^Amount \(/), { target: { value: AMOUNT } });
        const form = screen.getByRole('form', { name: 'Send' });

        fireEvent.submit(form);
        fireEvent.submit(form);
        expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1);
        expect(consoleError).not.toHaveBeenCalled();

        compose.resolve(composedSend());
        expect(await screen.findByTestId('confirm-modal')).toBeInTheDocument();
    });

    it('saves a new recipient as a contact after broadcast', async () => {
        const messaging = mount();
        await openPasswordConfirm(messaging);
        await approveWithPassword(messaging);
        await screen.findByRole('heading', { name: 'Broadcast pending' });

        fireEvent.click(screen.getByRole('button', { name: 'Save recipient' }));
        fireEvent.change(screen.getByLabelText('Contact name'), { target: { value: 'Alice' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save contact' }));

        await waitFor(() => expect(messaging.saveContact).toHaveBeenCalledWith({
            input: {
                name: 'Alice',
                notes: '',
                entries: [{ chain: 'bitcoin', address: TO, label: '' }],
            },
        }));
        expect(await screen.findByText('Recipient saved to contacts.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Save recipient' })).not.toBeInTheDocument();
    });

    it('submits only one contact save when the post-send form submits twice', async () => {
        const save = deferred();
        const messaging = mount({
            overrides: { saveContact: vi.fn(() => save.promise) },
        });
        await openPasswordConfirm(messaging);
        await approveWithPassword(messaging);
        await screen.findByRole('heading', { name: 'Broadcast pending' });
        fireEvent.click(screen.getByRole('button', { name: 'Save recipient' }));
        fireEvent.change(screen.getByLabelText('Contact name'), { target: { value: 'Alice' } });
        const saveForm = screen.getByLabelText('Contact name').closest('form');

        fireEvent.submit(saveForm);
        fireEvent.submit(saveForm);
        expect(messaging.saveContact).toHaveBeenCalledTimes(1);

        save.resolve({ id: 'alice', name: 'Alice', entries: [] });
        expect(await screen.findByText('Recipient saved to contacts.')).toBeInTheDocument();
    });

    it('ends on the signed-not-broadcast screen when the signed transaction is queued', async () => {
        const transient = Object.assign(new Error('node connection refused'), {
            name: 'BroadcastFailedTransientError',
        });
        const messaging = mount({ sendResult: transient });
        await openPasswordConfirm(messaging);
        await approveWithPassword(messaging);

        expect(await screen.findByRole('heading', { name: 'Signed. Not broadcast yet.' }))
            .toBeInTheDocument();
        expect(within(screen.getByRole('main')).getByRole('status')).toHaveTextContent(/queued-transactions banner/i);
        expect(within(screen.getByRole('main')).getByRole('status')).toHaveTextContent(/don't send this payment again/i);
        expect(screen.queryByText(TXID)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Send another' })).not.toBeInTheDocument();
    });

    it('shows a known node rejection plainly and retains the signed transaction without re-signing', async () => {
        const sdk = sdkBroadcastHarness(new Error(
            'Transaction broadcast failed: bad-txns-inputs-missingorspent (code -25)',
        ));
        const messaging = mount({ sendResult: sdk.send, encoding: 'OP_RETURN' });
        await openPasswordConfirm(messaging);
        await approveWithPassword(messaging);

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(
            'One of the coins this transaction spends was already used by another transaction. Nothing was sent.',
        );
        expect(alert).not.toHaveTextContent('bad-txns-inputs-missingorspent');
        expect(sdk.signPsbt).toHaveBeenCalledTimes(1);
        expect(sdk.signPsbt).toHaveBeenCalledWith(expect.objectContaining({ psbtHex: PSBT }));
        expect(sdk.broadcastTx).toHaveBeenCalledTimes(1);
        expect(sdk.queued).toEqual([]);
        expect((await sdk.pendingTxs.list()).at(-1)).toMatchObject({
            status: 'failed',
            txid: TXID,
            txHex: '0200000001signed',
        });
    });

    it('keeps a timed-out signed transaction retryable and does not sign it again', async () => {
        const sdk = sdkBroadcastHarness(new Error('ETIMEDOUT after signing'));
        const messaging = mount({ sendResult: sdk.send, encoding: 'OP_RETURN' });
        await openPasswordConfirm(messaging);
        await approveWithPassword(messaging);

        expect(await screen.findByRole('heading', { name: 'Signed. Not broadcast yet.' }))
            .toBeInTheDocument();
        expect(within(screen.getByRole('main')).getByRole('status')).toHaveTextContent(/waiting in the queued-transactions banner/i);
        expect(within(screen.getByRole('main')).getByRole('status')).not.toHaveTextContent('ETIMEDOUT');
        expect(sdk.signPsbt).toHaveBeenCalledTimes(1);
        expect(sdk.signPsbt).toHaveBeenCalledWith(expect.objectContaining({ psbtHex: PSBT }));
        expect(sdk.broadcastTx).toHaveBeenCalledTimes(1);
        expect(sdk.queued).toEqual([
            expect.objectContaining({ signedTxHex: '0200000001signed', txid: TXID }),
        ]);
        expect((await sdk.pendingTxs.list()).at(-1)).toMatchObject({
            status: 'queued',
            txHex: '0200000001signed',
        });
    });

    it('treats a duplicate broadcast as delivered without signing another transaction', async () => {
        const sdk = sdkBroadcastHarness(new Error('Encoder RPC error: txn-already-known'));
        const messaging = mount({ sendResult: sdk.send, encoding: 'OP_RETURN' });
        await openPasswordConfirm(messaging);
        await approveWithPassword(messaging);

        expect(await screen.findByRole('heading', { name: 'Broadcast pending' })).toBeInTheDocument();
        expect(screen.getByLabelText(TXID)).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(sdk.signPsbt).toHaveBeenCalledTimes(1);
        expect(sdk.signPsbt).toHaveBeenCalledWith(expect.objectContaining({ psbtHex: PSBT }));
        expect(sdk.broadcastTx).toHaveBeenCalledTimes(1);
        expect(sdk.queued).toEqual([]);
        expect((await sdk.pendingTxs.list()).at(-1)).toMatchObject({
            status: 'broadcast',
            txid: TXID,
        });
    });

    it('reviews the payment and builds an unsigned PSBT in watcher mode', async () => {
        const messaging = mount({ walletMode: 'watcher' });
        fireEvent.change(await screen.findByLabelText(/^To$/), { target: { value: TO } });
        fireEvent.change(screen.getByLabelText(/^Amount \(/), { target: { value: AMOUNT } });
        const scroller = screen.getByRole('main');
        scroller.scrollTop = 420;
        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));

        const review = await screen.findByRole('form', { name: 'Review payment' });
        expect(scroller.scrollTop).toBe(0);
        expect(screen.getByRole('heading', { name: 'Review and send' })).toHaveFocus();
        expect(review).toHaveTextContent(`Send ${AMOUNT} BTC on Bitcoin to ${TO}`);
        expect(review).toHaveTextContent('Network');
        expect(review).toHaveTextContent('Bitcoin');
        expect(review).toHaveTextContent('From');
        expect(review).toHaveTextContent('bc1qse…ndersa');
        expect(review).toHaveTextContent('Token');
        expect(review).toHaveTextContent('BTC');
        expect(review).toHaveTextContent('Amount');
        expect(review).toHaveTextContent(AMOUNT);
        expect(review).toHaveTextContent('Destination');
        expect(review).toHaveTextContent(TO);
        expect(review).toHaveTextContent('Network fee');
        expect(within(review).queryByLabelText('Password')).not.toBeInTheDocument();

        fireEvent.click(within(review).getByRole('button', { name: 'Create transaction for signing' }));

        await waitFor(() => expect(messaging.buildSendPsbtRequest).toHaveBeenCalledTimes(1));
        expect(messaging.buildSendPsbtRequest).toHaveBeenCalledWith(expect.objectContaining({
            walletId: WALLET_ID,
            chainId: CHAIN_ID,
            to: TO,
            tick: 'BTC',
            amount: AMOUNT,
        }));
        expect(messaging.sendToken).not.toHaveBeenCalled();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
        expect(await screen.findByRole('heading', { name: 'Unsigned transaction, ready for signing' }))
            .toBeInTheDocument();
        expect(screen.getByLabelText('Unsigned transaction hex')).toHaveValue(PSBT);
    });

    it('submits only one watcher build when the review form submits twice', async () => {
        const build = deferred();
        const messaging = mount({
            walletMode: 'watcher',
            overrides: { buildSendPsbtRequest: vi.fn(() => build.promise) },
        });
        await fillSendForm();
        const review = await screen.findByRole('form', { name: 'Review payment' });

        fireEvent.submit(review);
        fireEvent.submit(review);
        expect(messaging.buildSendPsbtRequest).toHaveBeenCalledTimes(1);

        build.resolve({ psbtHex: PSBT, fromAddress: FROM, chainId: CHAIN_ID });
        expect(await screen.findByRole('heading', { name: 'Unsigned transaction, ready for signing' }))
            .toBeInTheDocument();
    });

    it('keeps the reviewed source fixed when the active-address lookup settles late', async () => {
        const active = deferred();
        const messaging = mount({
            walletMode: 'watcher',
            overrides: {
                getAddressesByChain: vi.fn().mockResolvedValue({
                    [CHAIN_ID]: [
                        { id: 'active', address: FROM, publicKey: '02ab', derivationPath: "m/84'/0'/0'/0/0", source: 'hd' },
                        { id: 'fallback', address: SAVED_LOOKALIKE, publicKey: '02cd', derivationPath: "m/84'/0'/0'/0/1", source: 'hd' },
                    ],
                }),
                getActiveAddresses: vi.fn(() => active.promise),
            },
        });
        await waitFor(() => expect(screen.getByLabelText('From')).toHaveValue(SAVED_LOOKALIKE));
        await fillSendForm();
        const review = await screen.findByRole('form', { name: 'Review payment' });
        expect(review).toHaveTextContent('bc1q11…abcdef');

        active.resolve({ [CHAIN_ID]: { id: 'active', address: FROM } });
        await Promise.resolve();
        expect(review).toHaveTextContent('bc1q11…abcdef');
        fireEvent.click(within(review).getByRole('button', { name: 'Create transaction for signing' }));

        await waitFor(() => expect(messaging.buildSendPsbtRequest).toHaveBeenCalledWith(
            expect.objectContaining({ from: expect.objectContaining({ address: SAVED_LOOKALIKE }) }),
        ));
    });

    it('does not fire completion UI effects after an in-flight send unmounts', async () => {
        const build = deferred();
        const vibrate = vi.fn();
        vi.stubGlobal('navigator', { ...navigator, vibrate });
        const messaging = mount({
            walletMode: 'watcher',
            overrides: { buildSendPsbtRequest: vi.fn(() => build.promise) },
        });
        await fillSendForm();
        fireEvent.click(await screen.findByRole('button', { name: 'Create transaction for signing' }));
        await waitFor(() => expect(messaging.buildSendPsbtRequest).toHaveBeenCalledTimes(1));

        messaging.unmountView();
        build.resolve({ psbtHex: PSBT, fromAddress: FROM, chainId: CHAIN_ID });
        await Promise.resolve();
        await Promise.resolve();

        expect(vibrate).not.toHaveBeenCalled();
    });

    it('drops the form draft when Approve dispatches so a lock mid-send cannot offer the payment again', async () => {
        const broadcast = deferred();
        const draftKey = `xc:formdraft:send:${WALLET_ID}`;
        const messaging = mount({
            messagingOverrides: {
                getSettings: vi.fn().mockResolvedValue({
                    walletMode: 'full',
                    activeNetwork: 'mainnet',
                    grace: { testSendThresholdSats: 0 },
                    privacy: { formDraftTtlMs: 86_400_000 },
                }),
                sendToken: vi.fn(() => broadcast.promise),
            },
        });
        await openPasswordConfirm(messaging);
        expect(localStorage.getItem(draftKey)).not.toBeNull();

        await approveWithPassword(messaging);

        expect(localStorage.getItem(draftKey)).toBeNull();
        messaging.unmountView();
        broadcast.resolve({ txid: TXID });
        await Promise.resolve();
        expect(localStorage.getItem(draftKey)).toBeNull();
    });
});

describe.each(['ledger', 'trezor'])('%s hardware signing flow', (kind) => {
    it('connects, verifies the receive address on-device, and signs a send', async () => {
        const hardware = await pairMockHardware(kind);

        expect(hardware.pairingInfo.vendor).toBe(kind);
        if (kind === 'ledger') expect(hardware.getTransport).toHaveBeenCalledOnce();
        else expect(hardware.getConnect).toHaveBeenCalledOnce();

        await expect(hardware.signer.getAddresses({
            chainId: CHAIN_ID,
            accountIndex: 0,
            change: 0,
            startIndex: 0,
            count: 1,
            addressType: 'p2wpkh',
            verify: true,
        })).resolves.toEqual([expect.objectContaining({ address: FROM })]);
        if (kind === 'ledger') {
            expect(hardware.device.getWalletPublicKey).toHaveBeenLastCalledWith(
                "m/84'/0'/0'/0/0",
                { verify: true, format: 'bech32' },
            );
        } else {
            expect(hardware.device.getAddress).toHaveBeenLastCalledWith(expect.objectContaining({
                path: "m/84'/0'/0'/0/0",
                showOnTrezor: true,
            }));
        }

        const messaging = mount({ hardware });
        await approveHardwareSend(messaging);

        await waitFor(() => expect(messaging.sendAssetHw).toHaveBeenCalledOnce());
        expect(messaging.sendAssetHw).toHaveBeenCalledWith(expect.objectContaining({
            signerId: hardware.signer.id,
            prebuiltPsbt: expect.objectContaining({ psbtHex: PSBT }),
        }));
        expect(await screen.findByRole('heading', { name: 'Broadcast pending' })).toBeInTheDocument();
        expect(screen.getByText('a1b2c3…deeff0')).toBeInTheDocument();
        if (kind === 'ledger') {
            expect(hardware.device.createPaymentTransaction).toHaveBeenCalledOnce();
        } else {
            expect(hardware.device.signTransaction).toHaveBeenCalledOnce();
        }
    });

    it('returns to the intact send form when the user rejects on the device', async () => {
        const hardware = await pairMockHardware(kind, 'reject');
        const messaging = mount({ hardware });

        await approveHardwareSend(messaging);

        await waitFor(() => expect(messaging.sendAssetHw).toHaveBeenCalledOnce());
        expect(await screen.findByTestId('confirm-notice')).toHaveTextContent(
            'Signing was canceled on your hardware wallet. Nothing was signed. Review the details and select Approve again when you are ready.',
        );
        expect(screen.getByTestId('confirm-modal')).toBeInTheDocument();
        await waitFor(() => expect(screen.getByTestId('confirm-approve')).toBeEnabled());
        expect(screen.queryByText(/Couldn't send/i)).not.toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Broadcast pending' })).not.toBeInTheDocument();
    });

    it('reports a disconnect that happens while the device is signing', async () => {
        let rejectDevice;
        const signBehavior = vi.fn(() => new Promise((_resolve, reject) => {
            rejectDevice = reject;
        }));
        const hardware = await pairMockHardware(kind, signBehavior);
        const messaging = mount({ hardware });

        await approveHardwareSend(messaging);
        await waitFor(() => expect(signBehavior).toHaveBeenCalledOnce());
        await act(async () => {
            rejectDevice(new Error('device disconnected during signing'));
        });

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Your hardware wallet disconnected before signing finished. Reconnect and unlock it, then select Approve again.',
        );
        expect(screen.getByTestId('confirm-modal')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Broadcast pending' })).not.toBeInTheDocument();
    });
});

describe('Send refused by a freeze armed during the review', () => {
    const frozen = () => Object.assign(
        new Error('Signing is frozen by panic mode (1440 min remaining)'),
        { name: 'PanicModeActiveError' },
    );

    it('states a self-armed freeze once, in the form notice, with no generic retry line', async () => {
        const { activatePanicMode } = await import('../../../packages/core/src/flows/panicMode.js');
        const messaging = mount({ sendResult: frozen() });
        await openPasswordConfirm(messaging);
        activatePanicMode();
        await approveWithPassword(messaging);

        expect(await screen.findByText('Panic mode is on. This send cannot be signed.')).toBeInTheDocument();
        expect(screen.queryByText(/Something went wrong/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Signing is frozen by panic mode/)).not.toBeInTheDocument();
    });

    it('keeps the generic failure line and names no freeze when it was duress-armed', async () => {
        const { activatePanicMode, PANIC_ARMED_DURESS } = await import('../../../packages/core/src/flows/panicMode.js');
        const messaging = mount({ sendResult: frozen() });
        await openPasswordConfirm(messaging);
        activatePanicMode({ armedBy: PANIC_ARMED_DURESS });
        // The form logs an unclassified failure; the screen is what an observer reads.
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await approveWithPassword(messaging);

        expect(await screen.findByText(/Couldn't send\. Something went wrong\. Try again\./)).toBeInTheDocument();
        expect(screen.queryByText(/panic|frozen/i)).not.toBeInTheDocument();
    });
});
