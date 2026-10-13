// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ledger = vi.hoisted(() => ({
    getLedgerTransport: vi.fn(),
    pairLedgerSigner: vi.fn(),
    resetLedgerTransport: vi.fn(),
}));

vi.mock('../../../packages/extension/src/signers/ledgerFactory.js', () => ledger);

import * as extensionLedger from '../../../packages/extension/src/signers/ledgerFactory.js';
import * as backgroundSignerBridge from '../../../packages/extension/src/background/signerBridge.js';
import * as webLedger from '../../../packages/web/src/signers/ledgerFactory.js';
import {
    registerSigner,
    unregisterSigner,
} from '../../../packages/web/src/signerBridge.js';
import {
    getTrezorConnect,
    pairTrezorSigner,
    resetTrezorConnect,
} from '../../../packages/web/src/signers/trezorFactory.js';

const hostedScript = 'https://connect.trezor.io/9/trezor-connect.js';

beforeEach(() => {
    resetTrezorConnect();
    delete window.TrezorConnect;
    unregisterSigner('signer-1');
    unregisterSigner('signer-2');
    backgroundSignerBridge.clearAll();
});

afterAll(() => {
    document.querySelector(`script[src="${hostedScript}"]`)?.remove();
    delete window.TrezorConnect;
    unregisterSigner('signer-1');
    unregisterSigner('signer-2');
    backgroundSignerBridge.clearAll();
});

function fakeSigner() {
    return {
        getStatus: vi.fn(async () => ({ connected: true })),
        getAddresses: vi.fn(async () => ['bc1qaddress']),
        getPublicKey: vi.fn(async () => 'public-key'),
        signPsbt: vi.fn(async () => ({ signedPsbtHex: 'abcd' })),
        signMessage: vi.fn(async () => ({ signature: 'signature' })),
    };
}

describe('web Ledger factory', () => {
    it('uses the shared WebHID implementation from the extension shell', () => {
        expect(webLedger.getLedgerTransport).toBe(extensionLedger.getLedgerTransport);
        expect(webLedger.pairLedgerSigner).toBe(extensionLedger.pairLedgerSigner);
        expect(webLedger.resetLedgerTransport).toBe(extensionLedger.resetLedgerTransport);
    });
});

describe('web Trezor factory', () => {
    it('initializes an injected Connect client once and resets its cache', async () => {
        const connect = { init: vi.fn(async () => {}) };
        const loader = vi.fn(async () => ({ default: connect }));

        expect(await getTrezorConnect(loader)).toBe(connect);
        expect(await getTrezorConnect(loader)).toBe(connect);
        expect(loader).toHaveBeenCalledTimes(1);
        expect(connect.init).toHaveBeenCalledWith({
            manifest: {
                email: 'support@xchain.io',
                appUrl: 'https://xchain.io/wallet',
            },
            lazyLoad: true,
        });

        resetTrezorConnect();
        await getTrezorConnect(loader);
        expect(loader).toHaveBeenCalledTimes(2);
    });

    it('retries after Connect initialization fails', async () => {
        const failed = { init: vi.fn(async () => { throw new Error('init failed'); }) };
        const connected = { init: vi.fn(async () => {}) };
        const loader = vi.fn()
            .mockResolvedValueOnce(failed)
            .mockResolvedValueOnce(connected);

        await expect(getTrezorConnect(loader)).rejects.toThrow('init failed');
        await expect(getTrezorConnect(loader)).resolves.toBe(connected);
        expect(loader).toHaveBeenCalledTimes(2);
    });

    it('removes a failed hosted script so a later attempt can reload it', async () => {
        const firstAttempt = getTrezorConnect();
        const failedScript = document.querySelector(`script[src="${hostedScript}"]`);
        failedScript.dispatchEvent(new Event('error'));

        await expect(firstAttempt).rejects.toThrow('failed to load Trezor Connect');
        expect(failedScript.isConnected).toBe(false);

        const secondAttempt = getTrezorConnect();
        const retryScript = document.querySelector(`script[src="${hostedScript}"]`);
        expect(retryScript).not.toBe(failedScript);
        retryScript.dispatchEvent(new Event('error'));
        await expect(secondAttempt).rejects.toThrow('failed to load Trezor Connect');
    });

    it('binds the initialized browser client to the shared pairing flow', async () => {
        const connect = {
            init: vi.fn(async () => {}),
            getFeatures: vi.fn(async () => ({
                success: true,
                payload: {
                    device_id: 'device-1',
                    internal_model: 'T2T1',
                    major_version: 2,
                    minor_version: 8,
                    patch_version: 1,
                    label: 'Desk Trezor',
                },
            })),
        };

        const result = await pairTrezorSigner({ loader: async () => connect });

        expect(result.pairingInfo).toEqual({
            vendor: 'trezor',
            model: 'T2T1',
            deviceIdentifier: 'device-1',
            firmwareVersion: '2.8.1',
        });
        expect(result.signer.displayName).toBe('Desk Trezor (T2T1)');
    });

    it('loads the hosted script through the browser DOM', async () => {
        const pending = getTrezorConnect();
        const script = document.querySelector(`script[src="${hostedScript}"]`);
        const connect = { init: vi.fn(async () => {}) };

        expect(script).not.toBeNull();
        expect(script.async).toBe(true);
        window.TrezorConnect = connect;
        script.dispatchEvent(new Event('load'));

        await expect(pending).resolves.toBe(connect);
        expect(connect.init).toHaveBeenCalledTimes(1);
    });
});

describe('web signer transport binding', () => {
    it('rejects a payload that names a different registered signer', async () => {
        const signer1 = fakeSigner();
        const signer2 = fakeSigner();
        registerSigner('signer-1', signer1);
        registerSigner('signer-2', signer2);
        const signer1Transport = backgroundSignerBridge.getTransport('signer-1');

        await expect(signer1Transport({
            op: 'signPsbt',
            payload: { signerId: 'signer-2', chainId: 'bitcoin-mainnet' },
        })).rejects.toThrow('does not match registered id "signer-1"');
        expect(signer1.signPsbt).not.toHaveBeenCalled();
        expect(signer2.signPsbt).not.toHaveBeenCalled();
    });

    it('requires the complete bridge signer method surface', () => {
        const signer = fakeSigner();
        delete signer.signMessage;

        expect(() => registerSigner('signer-1', signer)).toThrow('must implement Signer');
        expect(backgroundSignerBridge.getTransport('signer-1')).toBeNull();
    });

    it('rejects a retained transport after its signer registration is replaced', async () => {
        const firstSigner = fakeSigner();
        const replacementSigner = fakeSigner();
        registerSigner('signer-1', firstSigner);
        const staleTransport = backgroundSignerBridge.getTransport('signer-1');
        registerSigner('signer-1', replacementSigner);

        await expect(staleTransport({
            op: 'status',
            payload: { signerId: 'signer-1' },
        })).rejects.toMatchObject({ name: 'SignerNotRegisteredError' });
        expect(firstSigner.getStatus).not.toHaveBeenCalled();
        expect(replacementSigner.getStatus).not.toHaveBeenCalled();
    });
});
