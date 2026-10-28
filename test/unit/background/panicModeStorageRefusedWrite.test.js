// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: chrome.storage.local refuses the panic record (quota, a storage
// fault). The popup and the service worker are separate realms, each with its
// own copy of core's panic flow, so this test loads two copies. The worker,
// which signs, must freeze from the popup's direct message alone, and the
// popup must report the freeze unsaved instead of saved.

import { afterEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'xchain.panicMode';
const RUNTIME_ID = 'test-extension-id';
const CORE = '../../../packages/core/src/flows/panicMode.js';
const ADAPTER = '../../../packages/extension/src/background/panicModeStorage.js';

function stubChrome({ refuseSet = false, refuseRemove = false } = {}) {
    const items = {};
    const changeListeners = [];
    const messageListeners = [];
    const runtime = {
        id: RUNTIME_ID,
        lastError: undefined,
        onMessage: { addListener: (fn) => messageListeners.push(fn), removeListener: () => {} },
    };
    const fire = (key, newValue) => {
        for (const fn of changeListeners) fn({ [key]: { newValue } }, 'local');
    };
    const refuse = (cb) => {
        runtime.lastError = { message: 'QUOTA_BYTES quota exceeded' };
        cb();
        runtime.lastError = undefined;
    };
    vi.stubGlobal('chrome', {
        runtime,
        storage: {
            local: {
                get: (key, cb) => cb({ [key]: items[key] }),
                set: (values, cb) => {
                    if (refuseSet) { refuse(cb); return; }
                    Object.assign(items, values);
                    cb();
                    for (const [k, v] of Object.entries(values)) fire(k, v);
                },
                remove: (key, cb) => {
                    if (refuseRemove) { refuse(cb); return; }
                    const had = Object.prototype.hasOwnProperty.call(items, key);
                    delete items[key];
                    cb();
                    if (had) fire(key, undefined);
                },
            },
            onChanged: { addListener: (fn) => changeListeners.push(fn) },
        },
    });
    // What runtime.onMessage delivers for a message sent from an extension
    // page (sender.id is ours, no tab): every listener in every other context
    // hears it, and the first response is the one the sender reads.
    const sendFromPage = (type, request, sender = { id: RUNTIME_ID, url: `chrome-extension://${RUNTIME_ID}/popup.html` }) =>
        new Promise((resolve, reject) => {
            let answered = false;
            const respond = (response) => {
                if (answered) return;
                answered = true;
                if (response?.ok) resolve(response.result);
                else reject(Object.assign(new Error(response?.error?.message || 'refused'), response?.error || {}));
            };
            let handled = false;
            for (const fn of [...messageListeners]) {
                if (fn({ type, request }, sender, respond) === true) handled = true;
            }
            if (!handled && !answered) reject(new Error(`no listener for ${type}`));
        });
    return { items, sendFromPage };
}

async function loadRealm() {
    vi.resetModules();
    const flows = await import(CORE);
    const adapter = await import(ADAPTER);
    return { flows, adapter };
}

async function bootWorkerAndPopup(chromeStub) {
    const worker = await loadRealm();
    const { isTrustedExtensionSender } = await import('../../../packages/extension/src/bridge/publicSurface.js');
    worker.adapter.attachPanicStateListener({ flows: worker.flows, isTrustedSender: isTrustedExtensionSender });
    await worker.adapter.initPanicModePersistence(worker.flows);

    const popup = await loadRealm();
    await popup.adapter.initPanicModePersistence(popup.flows, { notifyWorker: chromeStub.sendFromPage });
    return { worker, popup };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
});

describe('panic mode when chrome.storage.local refuses the write', () => {
    it('freezes signing in the worker and reports the popup freeze unsaved', async () => {
        const chromeStub = stubChrome({ refuseSet: true });
        const { worker, popup } = await bootWorkerAndPopup(chromeStub);

        popup.flows.activatePanicMode();
        await settle();

        expect(chromeStub.items[STORAGE_KEY]).toBeUndefined();
        expect(popup.flows.isSigningFrozen()).toBe(true);
        expect(popup.flows.getPanicModeSaveStatus()).toBe(popup.flows.PANIC_SAVE_UNSAVED);
        expect(worker.flows.isSigningFrozen()).toBe(true);
        expect(() => worker.flows.assertSigningAllowed()).toThrow(worker.flows.PanicModeActiveError);
    });

    it('keeps the worker frozen across a host rebuild that re-reads the empty store', async () => {
        const chromeStub = stubChrome({ refuseSet: true });
        const { worker, popup } = await bootWorkerAndPopup(chromeStub);
        popup.flows.activatePanicMode();
        await settle();

        await worker.adapter.initPanicModePersistence(worker.flows);
        expect(worker.flows.isSigningFrozen()).toBe(true);
    });

    it('shows a reopened popup the freeze the worker holds, as unsaved', async () => {
        const chromeStub = stubChrome({ refuseSet: true });
        const { popup } = await bootWorkerAndPopup(chromeStub);
        popup.flows.activatePanicMode();
        await settle();

        const reopened = await loadRealm();
        await reopened.adapter.initPanicModePersistence(reopened.flows, { notifyWorker: chromeStub.sendFromPage });
        expect(reopened.flows.isSigningFrozen()).toBe(true);
        expect(reopened.flows.getPanicModeSaveStatus()).toBe(reopened.flows.PANIC_SAVE_UNSAVED);
    });

    it('lifts the worker freeze when the user turns an unsaved freeze off', async () => {
        const chromeStub = stubChrome({ refuseSet: true });
        const { worker, popup } = await bootWorkerAndPopup(chromeStub);
        popup.flows.activatePanicMode();
        await settle();

        expect(await popup.flows.deactivatePanicMode()).toBe(true);
        await settle();
        expect(popup.flows.isSigningFrozen()).toBe(false);
        expect(worker.flows.isSigningFrozen()).toBe(false);
    });

    it('keeps both realms frozen when turning off is refused', async () => {
        const chromeStub = stubChrome({ refuseRemove: true });
        const { worker, popup } = await bootWorkerAndPopup(chromeStub);
        popup.flows.activatePanicMode();
        await settle();
        expect(chromeStub.items[STORAGE_KEY]).toBeDefined();

        expect(await popup.flows.deactivatePanicMode()).toBe(false);
        await settle();
        expect(popup.flows.isSigningFrozen()).toBe(true);
        expect(popup.flows.getPanicModeSaveStatus()).toBe(popup.flows.PANIC_SAVE_CLEAR_FAILED);
        expect(worker.flows.isSigningFrozen()).toBe(true);
    });

    it('turns a saved freeze off in both realms through storage', async () => {
        const chromeStub = stubChrome();
        const { worker, popup } = await bootWorkerAndPopup(chromeStub);
        popup.flows.activatePanicMode();
        await settle();
        expect(popup.flows.getPanicModeSaveStatus()).toBe(popup.flows.PANIC_SAVE_OK);
        expect(worker.flows.isSigningFrozen()).toBe(true);

        expect(await popup.flows.deactivatePanicMode()).toBe(true);
        await settle();
        expect(worker.flows.isSigningFrozen()).toBe(false);
    });

    it('shows a freeze armed in the popup to an approval window already open', async () => {
        const chromeStub = stubChrome({ refuseSet: true });
        const { popup } = await bootWorkerAndPopup(chromeStub);
        const approval = await loadRealm();
        await approval.adapter.initPanicModePersistence(approval.flows, { notifyWorker: chromeStub.sendFromPage });
        expect(approval.flows.isSigningFrozen()).toBe(false);

        popup.flows.activatePanicMode();
        await settle();
        expect(chromeStub.items[STORAGE_KEY]).toBeUndefined();
        expect(approval.flows.isSigningFrozen()).toBe(true);

        expect(await popup.flows.deactivatePanicMode()).toBe(true);
        await settle();
        expect(approval.flows.isSigningFrozen()).toBe(false);
    });

    it('refuses the direct channel to a web page', async () => {
        const chromeStub = stubChrome({ refuseSet: true });
        const { worker } = await bootWorkerAndPopup(chromeStub);
        const record = { activatedAt: Date.now(), expiresAt: Date.now() + 60_000, durationMs: 60_000, armedBy: 'self' };
        const webSender = { id: RUNTIME_ID, url: 'https://example.test/', tab: { id: 4 }, origin: 'https://example.test' };

        const approval = await loadRealm();
        await approval.adapter.initPanicModePersistence(approval.flows, { notifyWorker: chromeStub.sendFromPage });

        await expect(chromeStub.sendFromPage('panic.state.hold', record, webSender))
            .rejects.toMatchObject({ code: 'FORBIDDEN_SENDER' });
        expect(worker.flows.isSigningFrozen()).toBe(false);
        expect(approval.flows.isSigningFrozen()).toBe(false);
    });
});
