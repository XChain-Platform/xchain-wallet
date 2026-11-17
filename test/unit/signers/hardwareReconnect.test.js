// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Reconnect after lock: a hardware wallet paired before a lock (or a reload)
// must still sign after unlock, in every shell. Each shell's bridge registers
// a session signer per SignerRecord; the device opens on the first sign, a
// lock forgets it, and the next sign opens it again through the factory. The
// sign ops run under hardwareSession, so the sign page sees each step, a
// failed open waits for Try again, and Back rejects with HW_SIGN_BACK.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { MockHardwareSigner } from './MockHardwareSigner.js';
import * as hardwareSession from '../../../packages/core/src/signers/hardwareSession.js';
import {
    _resetHardwareReconnectForTests,
    makeHardwareSessionSigner,
    setHardwareFactories,
    workingHardwareVendors,
} from '../../../packages/core/src/signers/hardwareReconnect.js';
import {
    trackHardwareFactories,
    useHardwareReconnect,
} from '../../../packages/core/src/shared/hooks/useHardwareSessionReset.js';
import * as bgSignerBridge from '../../../packages/extension/src/background/signerBridge.js';
import * as webBridge from '../../../packages/web/src/signerBridge.js';
import * as popupBridge from '../../../packages/extension/src/popup/signerBridge.js';
import * as desktopBridge from '../../../packages/desktop/renderer/signerBridge.js';

const RECORD = Object.freeze({
    id: 'sig-trezor-1',
    walletId: 'hw-wallet-1',
    vendor: 'trezor',
    model: 'Safe 3',
    deviceIdentifier: 'device-abc',
});
const PAYLOAD = Object.freeze({ signerId: RECORD.id, chainId: 'bitcoin-mainnet', psbtHex: '70736274ff' });

/**
 * A shell's factory stack on MockHardwareSigner: a tracked module (so a lock
 * runs its reset) whose pair function opens a fresh mock device each time.
 * A reset closes every device opened before it, as a closed WebHID transport
 * or Connect session would.
 */
function mockShell({ deviceIdentifier = RECORD.deviceIdentifier } = {}) {
    const opened = [];
    const pairTrezorSigner = vi.fn(async () => {
        const signer = new MockHardwareSigner({ vendor: 'trezor', model: RECORD.model });
        opened.push(signer);
        return { signer, pairingInfo: { vendor: 'trezor', model: RECORD.model, deviceIdentifier, firmwareVersion: '2.8.1' } };
    });
    const resetTrezorConnect = vi.fn(() => {
        for (const signer of opened) {
            signer.signPsbt = async () => { throw new Error('Device disconnected'); };
        }
    });
    const tracked = trackHardwareFactories({
        trezor: async () => ({ pairTrezorSigner, resetTrezorConnect }),
    });
    const pairTrezor = (...args) => tracked.load('trezor').then((m) => m.pairTrezorSigner(...args));
    setHardwareFactories({ trezor: pairTrezor, ledger: null });
    return { opened, pairTrezorSigner, resetTrezorConnect, lock: () => tracked.reset() };
}

function recordEvents() {
    const events = [];
    const off = hardwareSession.subscribe((e) => events.push(`${e.type}:${e.type === 'step' ? e.op.steps.at(-1) : e.op.op}`));
    return { events, off };
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

describe('web shell: a hardware wallet signs after lock and unlock', () => {
    it('opens the device on the first sign, reports each step, and reopens it after a lock', async () => {
        const shell = mockShell();
        const { events, off } = recordEvents();

        // Unlock: the reconnect pass registers the record; nothing opens yet.
        webBridge.registerHardwareRecord(RECORD);
        const transport = bgSignerBridge.getTransport(RECORD.id);
        expect(transport).toBeTypeOf('function');
        expect(shell.pairTrezorSigner).not.toHaveBeenCalled();
        // A status poll never opens the device.
        await expect(transport({ op: 'status', payload: PAYLOAD })).resolves.toBe('available');
        expect(shell.pairTrezorSigner).not.toHaveBeenCalled();

        const first = await transport({ op: 'signPsbt', payload: PAYLOAD });
        expect(first).toMatchObject({ txid: '0'.repeat(64) });
        expect(shell.pairTrezorSigner).toHaveBeenCalledTimes(1);
        expect(shell.opened[0].calls.signPsbt).toBe(1);
        expect(events).toEqual([
            'begin:signPsbt', 'step:connected', 'step:unlocked', 'step:confirm', 'step:signed', 'end:signPsbt',
        ]);

        // Lock: the shell's reset closes the device's transport.
        await shell.lock();
        expect(shell.resetTrezorConnect).toHaveBeenCalledTimes(1);

        // Unlock: registering the same record again keeps one registration.
        webBridge.registerHardwareRecord(RECORD);
        expect(webBridge.registeredIds()).toEqual([RECORD.id]);
        const again = await bgSignerBridge.getTransport(RECORD.id)({ op: 'signPsbt', payload: PAYLOAD });
        expect(again).toMatchObject({ txid: '0'.repeat(64) });
        expect(shell.pairTrezorSigner).toHaveBeenCalledTimes(2);
        expect(shell.opened[1].calls.signPsbt).toBe(1);
        off();
    });

    it('keeps the device a pairing opened, and reopens it once a lock closed it', async () => {
        const shell = mockShell();
        const paired = new MockHardwareSigner({ vendor: 'trezor', model: RECORD.model });
        // Pairing hands over the live device, then the unlock pass adopts it.
        webBridge.registerSigner(RECORD.id, paired);
        webBridge.registerHardwareRecord(RECORD);
        await bgSignerBridge.getTransport(RECORD.id)({ op: 'signPsbt', payload: PAYLOAD });
        expect(paired.calls.signPsbt).toBe(1);
        expect(shell.pairTrezorSigner).not.toHaveBeenCalled();

        await shell.lock();
        await bgSignerBridge.getTransport(RECORD.id)({ op: 'signPsbt', payload: PAYLOAD });
        expect(paired.calls.signPsbt).toBe(1);
        expect(shell.pairTrezorSigner).toHaveBeenCalledTimes(1);
    });

    it('signs a message under the session too', async () => {
        mockShell();
        const { events, off } = recordEvents();
        webBridge.registerHardwareRecord(RECORD);
        await expect(bgSignerBridge.getTransport(RECORD.id)({ op: 'signMessage', payload: PAYLOAD }))
            .resolves.toMatchObject({ signature: '0'.repeat(128) });
        expect(events[0]).toBe('begin:signMessage');
        expect(events.at(-1)).toBe('end:signMessage');
        off();
    });
});

describe('the sign page: a failed open waits for Try again or Back', () => {
    it('fails the Device step when the silent open is refused, and Try again opens it and signs', async () => {
        const shell = mockShell();
        // No permission without a click: the first silent open is refused.
        shell.pairTrezorSigner.mockImplementationOnce(async () => {
            throw Object.assign(new Error('Must be handling a user gesture to show a permission request.'), { name: 'SecurityError' });
        });
        const seen = [];
        const off = hardwareSession.subscribe((e) => seen.push(e));
        webBridge.registerHardwareRecord(RECORD);

        const signing = bgSignerBridge.getTransport(RECORD.id)({ op: 'signPsbt', payload: PAYLOAD });
        await waitFor(() => expect(seen.some((e) => e.type === 'fail')).toBe(true));
        const failed = seen.find((e) => e.type === 'fail').op;
        expect(failed.steps).toEqual([]);
        expect(failed.failure.kind).toBe('other');

        // Try again (the sign page's click) runs the factory again.
        hardwareSession.retry(failed.opId);
        await expect(signing).resolves.toMatchObject({ txid: '0'.repeat(64) });
        expect(shell.pairTrezorSigner).toHaveBeenCalledTimes(2);
        off();
    });

    it('marks an unplugged device and a device rejection, and Back rejects with HW_SIGN_BACK', async () => {
        const shell = mockShell();
        shell.pairTrezorSigner.mockImplementationOnce(async () => {
            throw Object.assign(new Error('Device disconnected'), { code: 'HW_DISCONNECTED' });
        });
        const seen = [];
        const off = hardwareSession.subscribe((e) => seen.push(e));
        webBridge.registerHardwareRecord(RECORD);

        const signing = bgSignerBridge.getTransport(RECORD.id)({ op: 'signPsbt', payload: PAYLOAD });
        signing.catch(() => {});
        await waitFor(() => expect(seen.some((e) => e.type === 'fail')).toBe(true));
        const failed = seen.find((e) => e.type === 'fail').op;
        expect(failed.failure.kind).toBe('unplugged');

        hardwareSession.cancel(failed.opId);
        await expect(signing).rejects.toMatchObject({ code: 'HW_SIGN_BACK' });
        expect(hardwareSession.current()).toBeNull();
        off();
    });

    it('refuses a different device than the one the wallet was connected with', async () => {
        mockShell({ deviceIdentifier: 'someone-elses-device' });
        const seen = [];
        const off = hardwareSession.subscribe((e) => seen.push(e));
        webBridge.registerHardwareRecord(RECORD);
        const signing = bgSignerBridge.getTransport(RECORD.id)({ op: 'signPsbt', payload: PAYLOAD });
        signing.catch(() => {});
        await waitFor(() => expect(seen.some((e) => e.type === 'fail')).toBe(true));
        hardwareSession.cancel(seen.find((e) => e.type === 'fail').op.opId);
        await expect(signing).rejects.toMatchObject({ code: 'HW_SIGN_BACK' });
        off();
    });
});

describe('extension popup shell: a hardware wallet signs after lock and unlock', () => {
    function makeEvent() {
        const listeners = new Set();
        return {
            addListener: (fn) => listeners.add(fn),
            removeListener: (fn) => listeners.delete(fn),
            emit: (msg) => { for (const fn of listeners) fn(msg); },
        };
    }

    it('serves the background sign request through a reopened device', async () => {
        const shell = mockShell();
        const port = { onMessage: makeEvent(), onDisconnect: makeEvent(), postMessage: vi.fn() };
        vi.stubGlobal('chrome', { runtime: { connect: vi.fn(() => port) } });

        popupBridge.registerHardwareRecord(RECORD);
        expect(port.postMessage).toHaveBeenCalledWith({ kind: 'register', signerIds: [RECORD.id] });

        const request = (reqId) => port.onMessage.emit({ kind: 'request', reqId, op: 'signPsbt', payload: PAYLOAD });
        request('r-1');
        await waitFor(() => expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: 'response', reqId: 'r-1', ok: true })));

        await shell.lock();
        popupBridge.registerHardwareRecord(RECORD);
        request('r-2');
        await waitFor(() => expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: 'response', reqId: 'r-2', ok: true })));
        expect(shell.pairTrezorSigner).toHaveBeenCalledTimes(2);
    });
});

describe('desktop shell: a hardware wallet signs after lock and unlock', () => {
    it('serves the main-process sign request through a reopened device', async () => {
        const shell = mockShell();
        let inbound = null;
        const ipc = {
            postMessage: vi.fn(),
            onMessage: vi.fn((fn) => { inbound = fn; return () => {}; }),
        };
        globalThis.xchainWalletSignerBridge = ipc;

        desktopBridge.registerHardwareRecord(RECORD);
        expect(ipc.postMessage).toHaveBeenCalledWith({ kind: 'register', signerIds: [RECORD.id] });

        inbound({ kind: 'request', reqId: 'd-1', op: 'signPsbt', payload: PAYLOAD });
        await waitFor(() => expect(ipc.postMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: 'response', reqId: 'd-1', ok: true })));

        await shell.lock();
        desktopBridge.registerHardwareRecord(RECORD);
        inbound({ kind: 'request', reqId: 'd-2', op: 'signPsbt', payload: PAYLOAD });
        await waitFor(() => expect(ipc.postMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: 'response', reqId: 'd-2', ok: true })));
        expect(shell.pairTrezorSigner).toHaveBeenCalledTimes(2);
    });
});

describe('useHardwareReconnect', () => {
    it('registers each paired Trezor or Ledger of the active wallet once it is unlocked', async () => {
        const listSigners = vi.fn(async () => [
            RECORD,
            { id: 'sig-ledger-1', vendor: 'ledger', model: 'Nano X', deviceIdentifier: 'ledger-dev' },
            { id: 'sig-airgap-1', kind: 'airgap' },
        ]);
        const registerRecord = vi.fn();
        const { rerender } = renderHook((props) => useHardwareReconnect(props), {
            initialProps: { unlocked: false, walletId: RECORD.walletId, listSigners, registerRecord },
        });
        await Promise.resolve();
        expect(listSigners).not.toHaveBeenCalled();

        rerender({ unlocked: true, walletId: RECORD.walletId, listSigners, registerRecord });
        await waitFor(() => expect(registerRecord).toHaveBeenCalledTimes(2));
        expect(listSigners).toHaveBeenCalledTimes(1);
        expect(listSigners).toHaveBeenCalledWith(RECORD.walletId);
        expect(registerRecord.mock.calls.map(([r]) => r.id)).toEqual(['sig-trezor-1', 'sig-ledger-1']);

        // Lock (no active wallet), then unlock: the pass runs again.
        rerender({ unlocked: false, walletId: null, listSigners, registerRecord });
        rerender({ unlocked: true, walletId: RECORD.walletId, listSigners, registerRecord });
        await waitFor(() => expect(registerRecord).toHaveBeenCalledTimes(4));
        expect(listSigners).toHaveBeenCalledTimes(2);
    });

    it('keeps going when a bridge cannot register or the list read fails', async () => {
        const registerRecord = vi.fn(() => { throw new Error('no preload'); });
        renderHook(() => useHardwareReconnect({
            unlocked: true, walletId: 'w', listSigners: async () => ({ signers: [RECORD] }), registerRecord,
        }));
        await waitFor(() => expect(registerRecord).toHaveBeenCalledTimes(1));
        renderHook(() => useHardwareReconnect({
            unlocked: true, walletId: 'w', listSigners: async () => { throw new Error('locked'); }, registerRecord,
        }));
        await Promise.resolve();
    });
});

describe('which shells offer Connect Hardware Wallet', () => {
    it('counts Ledger only with WebHID and Trezor only outside the native app', () => {
        const fn = () => {};
        expect(workingHardwareVendors({ trezor: fn, ledger: fn }, { webHid: true, native: false })).toEqual(['trezor', 'ledger']);
        // The extension: no Trezor (licence), Ledger over WebHID.
        expect(workingHardwareVendors({ trezor: null, ledger: fn }, { webHid: true, native: false })).toEqual(['ledger']);
        expect(workingHardwareVendors({ trezor: null, ledger: fn }, { webHid: false, native: false })).toEqual([]);
        // The Android app: no WebHID and no Connect popup.
        expect(workingHardwareVendors({ trezor: fn, ledger: fn }, { webHid: false, native: true })).toEqual([]);
        expect(workingHardwareVendors({}, { webHid: true, native: false })).toEqual([]);
    });
});

describe('makeHardwareSessionSigner', () => {
    it('opens once for concurrent calls and reads addresses without a sign session', async () => {
        const live = new MockHardwareSigner({ vendor: 'ledger' });
        const open = vi.fn(async () => live);
        const signer = makeHardwareSessionSigner({ id: 's', vendor: 'ledger' }, { open });
        const { events, off } = recordEvents();
        await Promise.all([signer.getAddresses({ count: 1 }), signer.getPublicKey({})]);
        expect(open).toHaveBeenCalledTimes(1);
        expect(events).toEqual([]);
        expect(signer.isLive()).toBe(true);
        off();
    });
});
