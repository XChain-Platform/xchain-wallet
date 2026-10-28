// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Desktop screen capture protection (§1, S4). A desktop window showing a
// recovery phrase or a private key turns content protection on as the screen
// mounts and off as it unmounts, by navigation, lock or error alike. The
// renderer half forwards core's screen guard to the preload; the main half
// applies it to the sending window and to no other.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
    __resetScreenGuardForTests,
    isScreenGuardActive,
    useProtectedScreen,
} from '@xchain-wallet/core/shared/utils/screenGuard.js';
import {
    installDesktopScreenGuard,
    installDesktopSecretHideNotice,
} from '../../../packages/desktop/renderer/screenGuardBridge.js';
import {
    applyScreenProtection,
    notifyWindowHidden,
} from '../../../packages/desktop/main/screenProtection.js';
import rendererBoot from '../../../packages/desktop/renderer/main.jsx?raw';

afterEach(() => __resetScreenGuardForTests());

const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });

describe('desktop screen guard, renderer half', () => {
    it('turns protection on while a key screen is mounted and off after it unmounts', async () => {
        const setScreenProtected = vi.fn(async () => ({ ok: true }));
        expect(installDesktopScreenGuard({ xchainWalletWindow: { setScreenProtected } })).toBe(true);
        expect(isScreenGuardActive()).toBe(true);

        await settle();
        expect(setScreenProtected.mock.calls, 'boot releases any protection a reload left on').toEqual([[false]]);

        const screen = renderHook(() => useProtectedScreen());
        await settle();
        expect(setScreenProtected.mock.calls).toEqual([[false], [true]]);

        screen.unmount();
        await settle();
        expect(setScreenProtected.mock.calls).toEqual([[false], [true], [false]]);
    });

    it('keeps protection on until the last of two nested key screens unmounts', async () => {
        const setScreenProtected = vi.fn(async () => ({ ok: true }));
        installDesktopScreenGuard({ xchainWalletWindow: { setScreenProtected } });
        const outer = renderHook(() => useProtectedScreen());
        const inner = renderHook(() => useProtectedScreen());
        inner.unmount();
        await settle();
        expect(setScreenProtected.mock.calls).toEqual([[false], [true]]);
        outer.unmount();
        await settle();
        expect(setScreenProtected.mock.calls).toEqual([[false], [true], [false]]);
    });

    it('leaves the key screen usable when the bridge call fails', async () => {
        const setScreenProtected = vi.fn(() => { throw new Error('closed'); });
        installDesktopScreenGuard({ xchainWalletWindow: { setScreenProtected } });
        const screen = renderHook(() => useProtectedScreen());
        await settle();
        expect(() => screen.unmount()).not.toThrow();
        await settle();
        expect(setScreenProtected).toHaveBeenCalledTimes(3);
    });

    it('installs nothing when the preload offers no screen protection', () => {
        expect(installDesktopScreenGuard({})).toBe(false);
        expect(isScreenGuardActive()).toBe(false);
    });

    it('is installed by the renderer boot', () => {
        expect(rendererBoot).toMatch(/^installDesktopScreenGuard\(\);$/m);
        expect(rendererBoot).toMatch(/^installDesktopSecretHideNotice\(\);$/m);
    });

    it('turns a native hide notice into a renderer-only secret event', () => {
        let notify;
        const env = {
            CustomEvent,
            dispatchEvent: vi.fn(),
            xchainWalletWindow: { onHidden: vi.fn((listener) => { notify = listener; }) },
        };

        expect(installDesktopSecretHideNotice(env)).toBe(true);
        notify();

        expect(env.dispatchEvent).toHaveBeenCalledOnce();
        expect(env.dispatchEvent.mock.calls[0][0].type).toBe('xc:window-hidden');
    });
});

describe('desktop screen guard, main half', () => {
    const trusted = () => true;

    it('applies the request to the sending window only', () => {
        const own = { setContentProtection: vi.fn(), isDestroyed: () => false };
        const other = { setContentProtection: vi.fn(), isDestroyed: () => false };
        const sender = { id: 1 };
        const windowFor = vi.fn((s) => (s === sender ? own : other));

        expect(applyScreenProtection({ sender }, [true], { isTrustedSender: trusted, windowFor })).toEqual({ ok: true });
        expect(applyScreenProtection({ sender }, [false], { isTrustedSender: trusted, windowFor })).toEqual({ ok: true });
        expect(own.setContentProtection.mock.calls).toEqual([[true], [false]]);
        expect(other.setContentProtection).not.toHaveBeenCalled();
    });

    it('refuses an untrusted frame, a non-boolean, extra arguments and a closed window', () => {
        const win = { setContentProtection: vi.fn(), isDestroyed: () => false };
        const windowFor = () => win;
        const event = { sender: {} };
        expect(applyScreenProtection(event, [true], { isTrustedSender: () => false, windowFor }).ok).toBe(false);
        expect(applyScreenProtection(event, ['true'], { isTrustedSender: trusted, windowFor }).ok).toBe(false);
        expect(applyScreenProtection(event, [true, 2], { isTrustedSender: trusted, windowFor }).ok).toBe(false);
        expect(applyScreenProtection(event, [], { isTrustedSender: trusted, windowFor }).ok).toBe(false);
        expect(applyScreenProtection(event, [true], {
            isTrustedSender: trusted,
            windowFor: () => ({ setContentProtection: vi.fn(), isDestroyed: () => true }),
        }).ok).toBe(false);
        expect(applyScreenProtection(event, [true], { isTrustedSender: trusted, windowFor: () => null }).ok).toBe(false);
        expect(win.setContentProtection).not.toHaveBeenCalled();
    });

    it('notifies only the live renderer belonging to the hidden window', () => {
        const send = vi.fn();
        const win = {
            isDestroyed: () => false,
            webContents: { isDestroyed: () => false, send },
        };

        expect(notifyWindowHidden(win)).toBe(true);
        expect(send).toHaveBeenCalledWith('xchain:window-hidden');
        expect(notifyWindowHidden({ ...win, isDestroyed: () => true })).toBe(false);
        expect(notifyWindowHidden({
            ...win,
            webContents: { isDestroyed: () => true, send },
        })).toBe(false);
        expect(send).toHaveBeenCalledTimes(1);
    });
});
