/** @vitest-environment node */

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
    HID_VENDOR_ALLOWLIST,
    attachHidDenial,
    attachHidPermissions,
    createHidFrameGuard,
    isAppHidCheck,
    isAppHidSelect,
    isRemoteHidOrigin,
    observeHidFrames,
} from '../../../packages/desktop/main/permissions.js';

const appRoot = '/opt/xchain/renderer';
const appUrl = pathToFileURL(`${appRoot}/index.html`).href;

function fakeSession() {
    const handlers = {};
    const listeners = new Map();
    return {
        handlers,
        listeners,
        setPermissionRequestHandler: (fn) => { handlers.request = fn; },
        setPermissionCheckHandler: (fn) => { handlers.check = fn; },
        setDevicePermissionHandler: (fn) => { handlers.device = fn; },
        on: (name, fn) => { listeners.set(name, fn); },
    };
}

describe('HID permission wiring guards', () => {
    it('fails closed when required session capabilities are absent', () => {
        expect(() => attachHidPermissions(null, { appRoot })).toThrow(/session is required/);

        const cases = [
            ['setPermissionRequestHandler', /setPermissionRequestHandler is missing/],
            ['setDevicePermissionHandler', /setDevicePermissionHandler is missing/],
            ['setPermissionCheckHandler', /setPermissionCheckHandler is missing/],
            ['on', /session.on/],
        ];
        for (const [missing, pattern] of cases) {
            const session = fakeSession();
            delete session[missing];
            expect(() => attachHidPermissions(session, { appRoot })).toThrow(pattern);
        }
        expect(() => attachHidPermissions(fakeSession(), {})).toThrow(/opts.appRoot/);
    });

    it('checks every origin signal and permits unrelated check-only permissions', () => {
        const session = fakeSession();
        attachHidPermissions(session, { appRoot, guard: createHidFrameGuard() });

        expect(session.handlers.check({}, 'notifications', 'https://remote.example', {})).toBe(true);
        expect(session.handlers.check({}, 'hid', 'https://remote.example', {})).toBe(false);
        expect(session.handlers.check({}, 'hid', 'file://', {
            securityOrigin: 'https://remote.example',
        })).toBe(false);
        expect(session.handlers.check({}, 'hid', 'file://', {
            embeddingOrigin: 'https://remote.example',
        })).toBe(false);
        expect(session.handlers.check({}, 'hid', 'file://', {
            requestingUrl: 'https://remote.example/frame',
        })).toBe(false);
        expect(session.handlers.check({}, 'hid', 'file://', {
            requestingUrl: appUrl,
        })).toBe(true);
    });

    it('refuses WebUSB and Web Serial on the default session, even to the app origin', () => {
        const session = fakeSession();
        attachHidPermissions(session, { appRoot, guard: createHidFrameGuard() });

        for (const permission of ['usb', 'serial']) {
            expect(session.handlers.check({}, permission, 'file://', {})).toBe(false);
            expect(session.handlers.check({}, permission, 'file://', { requestingUrl: appUrl })).toBe(false);
            expect(session.handlers.check({}, permission, 'file:///', { securityOrigin: 'file:///' })).toBe(false);
            expect(session.handlers.check({}, permission, 'https://remote.example', {})).toBe(false);
        }
        // Only the device classes narrow: the shared UI's check-path grants stay.
        for (const permission of ['notifications', 'clipboard-read', 'clipboard-sanitized-write']) {
            expect(session.handlers.check({}, permission, 'file://', { requestingUrl: appUrl })).toBe(true);
        }
    });

    it('cancels the WebUSB and Web Serial pickers on the default session', () => {
        const session = fakeSession();
        attachHidPermissions(session, { appRoot, guard: createHidFrameGuard() });

        for (const [name, expected] of [['select-usb-device', undefined], ['select-serial-port', '']]) {
            const listener = session.listeners.get(name);
            expect(typeof listener).toBe('function');
            const event = { preventDefault: vi.fn() };
            const callback = vi.fn();
            const args = name === 'select-serial-port'
                ? [event, [{ portId: 'p1' }], {}, callback]
                : [event, { deviceList: [{ deviceId: 'd1', vendorId: HID_VENDOR_ALLOWLIST.LEDGER }] }, callback];
            listener(...args);
            expect(event.preventDefault).toHaveBeenCalledTimes(1);
            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback.mock.calls[0]).toEqual(expected === undefined ? [] : [expected]);
        }
        expect(typeof session.listeners.get('select-hid-device')).toBe('function');
    });

    it('uses the requesting frame URL for HID requests and the window URL as fallback', () => {
        const session = fakeSession();
        attachHidPermissions(session, { appRoot, guard: createHidFrameGuard() });
        const verdict = vi.fn();

        session.handlers.request(
            { getURL: () => appUrl },
            'hid',
            verdict,
            { requestingUrl: 'https://remote.example/frame' },
        );
        session.handlers.request({ getURL: () => appUrl }, 'hid', verdict, {});

        expect(verdict.mock.calls).toEqual([[false], [true]]);
    });

    it('allows only hardware-wallet vendors from an unpoisoned local session', () => {
        const guard = createHidFrameGuard();
        const session = fakeSession();
        attachHidPermissions(session, { appRoot, guard });

        expect(session.handlers.device({ deviceType: 'usb', origin: 'file://' })).toBe(false);
        expect(session.handlers.device({
            deviceType: 'hid', origin: 'https://remote.example',
            device: { vendorId: HID_VENDOR_ALLOWLIST.LEDGER },
        })).toBe(false);
        expect(session.handlers.device({ deviceType: 'hid', origin: 'file://', device: {} })).toBe(false);
        expect(session.handlers.device({
            deviceType: 'hid', origin: 'file://',
            device: { vendorId: HID_VENDOR_ALLOWLIST.TREZOR_T },
        })).toBe(true);
        expect(session.handlers.device({
            deviceType: 'hid', origin: 'file://', device: { vendorId: 1 },
        })).toBe(false);

        guard.noteSubframe('window-1');
        expect(session.handlers.device({
            deviceType: 'hid', origin: 'file://',
            device: { vendorId: HID_VENDOR_ALLOWLIST.LEDGER },
        })).toBe(false);
    });
});

describe('HID frame observation and picker refusal', () => {
    it('latches subframes, tolerates destroyed frame getters, and clears on window destruction', () => {
        const guard = createHidFrameGuard();
        const listeners = new Map();
        const contents = {
            id: 9,
            on: (name, fn) => { listeners.set(name, fn); },
        };
        observeHidFrames(contents, { guard });

        listeners.get('frame-created')({}, { frame: { parent: null } });
        expect(guard.hasSubframe()).toBe(false);
        const detached = {};
        Object.defineProperty(detached, 'parent', { get() { throw new Error('detached'); } });
        listeners.get('frame-created')({}, { frame: detached });
        expect(guard.hasSubframe()).toBe(false);
        listeners.get('will-frame-navigate')({ isMainFrame: false });
        expect(guard.hasSubframe()).toBe(true);
        listeners.get('destroyed')();
        expect(guard.hasSubframe()).toBe(false);

        expect(() => observeHidFrames(null, { guard })).not.toThrow();
        expect(() => observeHidFrames({}, { guard })).not.toThrow();
    });

    it('cancels remote, embedded, detached, and poisoned pickers', () => {
        const guard = createHidFrameGuard();
        const session = fakeSession();
        attachHidPermissions(session, { appRoot, guard });
        const select = session.listeners.get('select-hid-device');

        const drive = (details) => {
            const event = { preventDefault: vi.fn() };
            const callback = vi.fn();
            select(event, details, callback);
            return { event, callback };
        };

        expect(drive({ frame: { url: appUrl, parent: null } }).event.preventDefault).not.toHaveBeenCalled();
        expect(drive({ frame: { url: 'https://remote.example', parent: null } }).callback)
            .toHaveBeenCalledWith(null);
        expect(drive({ frame: { url: appUrl, parent: {} } }).callback).toHaveBeenCalledWith(null);

        const detached = { parent: null };
        Object.defineProperty(detached, 'url', { get() { throw new Error('detached'); } });
        expect(isAppHidSelect({ frame: detached }, appRoot)).toBe(false);

        guard.noteSubframe(1);
        expect(drive({ frame: { url: appUrl, parent: null } }).callback).toHaveBeenCalledWith(null);
    });

    it('classifies only positive remote origins as remote', () => {
        expect(isRemoteHidOrigin(undefined)).toBe(false);
        expect(isRemoteHidOrigin('')).toBe(false);
        expect(isRemoteHidOrigin('null')).toBe(false);
        expect(isRemoteHidOrigin('FILE://')).toBe(false);
        expect(isRemoteHidOrigin('https://remote.example')).toBe(true);
        expect(isAppHidCheck(undefined, undefined, appRoot)).toBe(true);
    });
});

describe('isolated bridge HID denial', () => {
    it('requires every permission hook', () => {
        expect(() => attachHidDenial()).toThrow(/session is required/);
        for (const missing of [
            'setPermissionRequestHandler',
            'setDevicePermissionHandler',
            'setPermissionCheckHandler',
            'on',
        ]) {
            const session = fakeSession();
            delete session[missing];
            expect(() => attachHidDenial(session)).toThrow(/missing/);
        }
    });

    it('refuses device permissions and cancels every device picker', () => {
        const session = fakeSession();
        attachHidDenial(session);
        const requestResult = vi.fn();
        session.handlers.request({}, 'media', requestResult);

        expect(requestResult).toHaveBeenCalledWith(false);
        expect(session.handlers.check({}, 'hid')).toBe(false);
        expect(session.handlers.check({}, 'usb')).toBe(false);
        expect(session.handlers.check({}, 'serial')).toBe(false);
        expect(session.handlers.check({}, 'notifications')).toBe(true);
        expect(session.handlers.device({})).toBe(false);

        for (const [name, expected] of [
            ['select-hid-device', undefined],
            ['select-usb-device', undefined],
            ['select-serial-port', ''],
        ]) {
            const event = { preventDefault: vi.fn() };
            const callback = vi.fn();
            const args = name === 'select-serial-port'
                ? [event, [], {}, callback]
                : [event, {}, callback];
            session.listeners.get(name)(...args);
            expect(event.preventDefault).toHaveBeenCalledOnce();
            if (expected === '') expect(callback).toHaveBeenCalledWith('');
            else expect(callback).toHaveBeenCalledWith();
        }
    });
});

describe('HID chooser default, as the module describes it', () => {
    it('never claims Electron auto-selects the first HID device for an un-prevented chooser', () => {
        // Electron v44.7.0 cancels an un-prevented select-hid-device (hid_chooser_controller.cc) and documents
        // first-device-wins only for Bluetooth, so a comment claiming otherwise contradicts the app-frame arm.
        const src = readFileSync(fileURLToPath(new URL('../../../packages/desktop/main/permissions.js', import.meta.url)), 'utf8');
        const prose = src.replace(/\s*\n\s*(\*|\/\/)\s*/g, ' ');
        expect(prose).not.toMatch(/documented default for an UNHANDLED `?select-hid-device`?/i);
        expect(prose).not.toMatch(/unhandled `?select-hid-device`? auto-selects/i);
        expect(prose).toMatch(/left un-prevented, which Electron answers by cancelling/);
    });
});

describe('bridge session permission logging', () => {
    function wire(env) {
        const session = fakeSession();
        const log = vi.fn();
        attachHidDenial(session, { env, log });
        return { session, log };
    }

    it('logs nothing by default', () => {
        const { session, log } = wire({});
        expect(session.handlers.check(null, 'hid', 'file://')).toBe(false);
        expect(log).not.toHaveBeenCalled();
    });

    it('logs each checked permission and verdict when the flag is 1', () => {
        const { session, log } = wire({ XCHAIN_LOG_BRIDGE_PERMISSIONS: '1' });
        expect(session.handlers.check(null, 'usb', 'https://connect.trezor.io')).toBe(false);
        expect(session.handlers.check(null, 'notifications', 'https://connect.trezor.io')).toBe(true);
        expect(log).toHaveBeenCalledTimes(2);
        expect(log.mock.calls[0][1]).toEqual({ permission: 'usb', requestingOrigin: 'https://connect.trezor.io', allowed: false });
        expect(log.mock.calls[1][1].allowed).toBe(true);
    });

    it('ignores other flag values', () => {
        const { session, log } = wire({ XCHAIN_LOG_BRIDGE_PERMISSIONS: 'true' });
        session.handlers.check(null, 'hid', 'file://');
        expect(log).not.toHaveBeenCalled();
    });
});
