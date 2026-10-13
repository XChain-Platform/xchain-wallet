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
import * as webLedger from '../../../packages/web/src/signers/ledgerFactory.js';
import {
    getTrezorConnect,
    pairTrezorSigner,
    resetTrezorConnect,
} from '../../../packages/web/src/signers/trezorFactory.js';

const hostedScript = 'https://connect.trezor.io/9/trezor-connect.js';

beforeEach(() => {
    resetTrezorConnect();
    delete window.TrezorConnect;
});

afterAll(() => {
    document.querySelector(`script[src="${hostedScript}"]`)?.remove();
    delete window.TrezorConnect;
});

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
