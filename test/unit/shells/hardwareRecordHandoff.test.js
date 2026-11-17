// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// After Add Wallet, every shell's signer bridge must hold the saved
// SignerRecord with its per-chain Ledger identities, not only the live
// signer: once the device is reopened in another coin app (after a lock, or
// to sign on another chain), the identity of that chain is the only way to
// confirm it is the same Ledger.
//
// The connect flows hand onSignerPaired a session signer built from the
// saved record (pairedSessionSigner), which each bridge stores as given; the
// shells also read the signer list again after an account is added, so a
// network that account added brings its identity. Proven here on the web,
// extension popup and desktop bridges, with a control showing the live
// signer alone is refused.

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import * as hardwareSession from '../../../packages/core/src/signers/hardwareSession.js';
import {
    _resetHardwareReconnectForTests,
    invalidateLiveSigners,
    pairedSessionSigner,
    setHardwareFactories,
} from '../../../packages/core/src/signers/hardwareReconnect.js';
import { ledgerIdentityFingerprint } from '../../../packages/core/src/signers/ledgerIdentity.js';
import { useHardwareReconnect } from '../../../packages/core/src/shared/hooks/useHardwareSessionReset.js';
import * as bgSignerBridge from '../../../packages/extension/src/background/signerBridge.js';
import * as webBridge from '../../../packages/web/src/signerBridge.js';
import * as popupBridge from '../../../packages/extension/src/popup/signerBridge.js';
import * as desktopBridge from '../../../packages/desktop/renderer/signerBridge.js';

const KEY_BTC = `02${'a1'.repeat(32)}`;
const KEY_LTC = `03${'b2'.repeat(32)}`;
const BTC_PATH = "m/84'/0'/0'/0/0";
const LTC_PATH = "m/84'/2'/0'/0/0";

// The record addHardwareWallet saved for a Ledger read in its Bitcoin and
// Litecoin apps.
const RECORD = Object.freeze({
    id: 'sig-ledger-1',
    walletId: 'hw-wallet-1',
    vendor: 'ledger',
    model: 'nanoX',
    deviceIdentifier: 'id-from-bitcoin-app',
    identities: {
        'bitcoin-mainnet': { path: BTC_PATH, fingerprint: ledgerIdentityFingerprint(KEY_BTC) },
        'litecoin-mainnet': { path: LTC_PATH, fingerprint: ledgerIdentityFingerprint(KEY_LTC) },
    },
});
const PAYLOAD = Object.freeze({ signerId: RECORD.id, chainId: 'litecoin-mainnet', psbtHex: '70736274ff' });

/** A Ledger stand-in with one app open, answering only that app's keys. */
function ledgerInApp(app) {
    const keys = app === 'Litecoin' ? { [LTC_PATH]: KEY_LTC } : { [BTC_PATH]: KEY_BTC };
    return {
        vendor: 'ledger',
        kind: 'ledger',
        model: 'nanoX',
        deviceIdentifier: app === 'Litecoin' ? 'id-from-litecoin-app' : 'id-from-bitcoin-app',
        getStatus: vi.fn(async () => 'available'),
        getAddresses: vi.fn(async () => []),
        getPublicKey: vi.fn(async ({ path }) => {
            if (!keys[path]) throw Object.assign(new Error('UNKNOWN_ERROR (0x6a82)'), { statusCode: 0x6a82 });
            return { publicKey: keys[path], chainCode: '', fingerprint: '' };
        }),
        signPsbt: vi.fn(async () => ({ signedTxHex: 'signed', signedPsbtHex: '' })),
        signMessage: vi.fn(async () => ({ signature: 'sig' })),
    };
}

/** The shell factory, now opening the Ledger in its Litecoin app. */
function litecoinAppFactory() {
    const opened = [];
    const factory = vi.fn(async () => {
        const signer = ledgerInApp('Litecoin');
        opened.push(signer);
        return {
            signer,
            pairingInfo: {
                vendor: 'ledger',
                model: 'nanoX',
                deviceIdentifier: signer.deviceIdentifier,
                firmwareVersion: '2.2.1',
                appName: 'Litecoin',
                chainIds: ['litecoin-mainnet'],
            },
        };
    });
    setHardwareFactories({ ledger: factory, trezor: null });
    return { factory, opened };
}

function makeEvent() {
    const listeners = new Set();
    return {
        addListener: (fn) => listeners.add(fn),
        removeListener: (fn) => listeners.delete(fn),
        emit: (msg) => { for (const fn of listeners) fn(msg); },
    };
}

beforeEach(() => {
    _resetHardwareReconnectForTests();
    bgSignerBridge.clearAll();
});

afterEach(() => {
    webBridge.unregisterSigner(RECORD.id);
    popupBridge._resetForTests();
    desktopBridge._resetForTests();
    bgSignerBridge.clearAll();
    delete globalThis.xchainWalletSignerBridge;
    vi.unstubAllGlobals();
    _resetHardwareReconnectForTests();
});

describe('after Add Wallet each bridge holds the saved record with its identities', () => {
    it('web: a Litecoin sign after a lock reopens the Ledger in its Litecoin app and signs', async () => {
        const { factory, opened } = litecoinAppFactory();
        webBridge.registerSigner(RECORD.id, pairedSessionSigner(RECORD, ledgerInApp('Bitcoin')));
        invalidateLiveSigners();

        await expect(bgSignerBridge.getTransport(RECORD.id)({ op: 'signPsbt', payload: PAYLOAD }))
            .resolves.toMatchObject({ signedTxHex: 'signed' });
        expect(factory).toHaveBeenCalledTimes(1);
        expect(opened[0].getPublicKey).toHaveBeenCalledWith({ chainId: 'litecoin-mainnet', path: LTC_PATH });
        expect(opened[0].signPsbt).toHaveBeenCalledOnce();
    });

    it('web control: the live signer alone has no identities, so the Litecoin app cannot be confirmed for a sign that names no key', async () => {
        const { opened } = litecoinAppFactory();
        const seen = [];
        const off = hardwareSession.subscribe((e) => seen.push(e));
        webBridge.registerSigner(RECORD.id, ledgerInApp('Bitcoin'));
        invalidateLiveSigners();

        const signing = bgSignerBridge.getTransport(RECORD.id)({ op: 'signPsbt', payload: PAYLOAD });
        signing.catch(() => {});
        await waitFor(() => expect(seen.some((e) => e.type === 'fail')).toBe(true));
        const failed = seen.find((e) => e.type === 'fail');
        // The Litecoin app is open, so the page never says to open it
        // (ruling 2026-11-15); with no key named there is nothing to read.
        expect(failed.op.failure.kind).not.toBe('wrong-app');
        expect(opened.every((signer) => signer.signPsbt.mock.calls.length === 0)).toBe(true);
        hardwareSession.cancel(failed.op.opId);
        await expect(signing).rejects.toMatchObject({ code: 'HW_SIGN_BACK' });
        off();
    });

    it('extension popup: serves the background sign request through the Litecoin app', async () => {
        const { opened } = litecoinAppFactory();
        const port = { onMessage: makeEvent(), onDisconnect: makeEvent(), postMessage: vi.fn() };
        vi.stubGlobal('chrome', { runtime: { connect: vi.fn(() => port) } });

        popupBridge.registerSigner(RECORD.id, pairedSessionSigner(RECORD, ledgerInApp('Bitcoin')));
        expect(port.postMessage).toHaveBeenCalledWith({ kind: 'register', signerIds: [RECORD.id] });
        invalidateLiveSigners();

        port.onMessage.emit({ kind: 'request', reqId: 'p-1', op: 'signPsbt', payload: PAYLOAD });
        await waitFor(() => expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: 'response', reqId: 'p-1', ok: true })));
        expect(opened[0].signPsbt).toHaveBeenCalledOnce();
    });

    it('desktop: serves the main-process sign request through the Litecoin app', async () => {
        const { opened } = litecoinAppFactory();
        let inbound = null;
        globalThis.xchainWalletSignerBridge = {
            postMessage: vi.fn(),
            onMessage: vi.fn((fn) => { inbound = fn; return () => {}; }),
        };

        desktopBridge.registerSigner(RECORD.id, pairedSessionSigner(RECORD, ledgerInApp('Bitcoin')));
        invalidateLiveSigners();

        inbound({ kind: 'request', reqId: 'd-1', op: 'signPsbt', payload: PAYLOAD });
        await waitFor(() => expect(globalThis.xchainWalletSignerBridge.postMessage)
            .toHaveBeenCalledWith(expect.objectContaining({ kind: 'response', reqId: 'd-1', ok: true })));
        expect(opened[0].signPsbt).toHaveBeenCalledOnce();
    });

    it('pairedSessionSigner leaves a non-hardware signer, or a missing record, as it is', () => {
        const live = ledgerInApp('Bitcoin');
        expect(pairedSessionSigner(null, live)).toBe(live);
        expect(pairedSessionSigner({ id: 'x', vendor: 'software' }, live)).toBe(live);
        const wrapped = pairedSessionSigner(RECORD, live);
        expect(wrapped.isHardwareSessionSigner).toBe(true);
        expect(wrapped.record.identities).toEqual(RECORD.identities);
    });
});

describe('a network added later reaches the bridge record', () => {
    it('useHardwareReconnect reads the list again when refreshKey changes', async () => {
        const listSigners = vi.fn(async () => [RECORD]);
        const registerRecord = vi.fn();
        const { rerender } = renderHook((props) => useHardwareReconnect(props), {
            initialProps: { unlocked: true, walletId: RECORD.walletId, listSigners, registerRecord, refreshKey: 0 },
        });
        await waitFor(() => expect(registerRecord).toHaveBeenCalledTimes(1));
        rerender({ unlocked: true, walletId: RECORD.walletId, listSigners, registerRecord, refreshKey: 1 });
        await waitFor(() => expect(registerRecord).toHaveBeenCalledTimes(2));
        expect(listSigners).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['web', 'packages/web/src/App.jsx'],
        ['extension', 'packages/extension/src/popup/App.jsx'],
        ['desktop', 'packages/desktop/renderer/App.jsx'],
    ])('%s reads the signer list again after Add account', (_shell, rel) => {
        const src = readFileSync(rel, 'utf8');
        expect(src).toMatch(/useHardwareReconnect\(\{[\s\S]*?refreshKey: signerListKey,?\s*\}\)/);
        expect(src).toMatch(/<AddAccountForm[\s\S]*?onCreated=\{\(account\) => \{[\s\S]*?setSignerListKey\(\(n\) => n \+ 1\);[\s\S]*?\}\}/);
        // After Add Wallet the shell switches to the new wallet, which reads the list for it.
        expect(src).toMatch(/const handleWalletAdded = \(wallet\) => \{[\s\S]*?handleSwitchWallet\(wallet\.id/);
        expect(src).toMatch(/const handleHardwareWalletAdded = \(walletId\) => \{[\s\S]*?handleWalletAdded\(/);
    });

    it.each([
        ['web', 'packages/web/src/signerBridge.js'],
        ['extension', 'packages/extension/src/popup/signerBridge.js'],
        ['desktop', 'packages/desktop/renderer/signerBridge.js'],
    ])('%s bridge keeps a session signer handed to it as given', (_shell, rel) => {
        const src = readFileSync(rel, 'utf8');
        expect(src).toMatch(/sessionSignerFor\(\s*(?:existing|liveSigners\.get\(signerId\))\s*,\s*signerId,\s*signer\s*\)/);
    });
});
