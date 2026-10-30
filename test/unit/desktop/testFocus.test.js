/**
 * @vitest-environment node
 */

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    applyTestMockKeychain,
    applyTestNoFocusPolicy,
    focusWindow,
    mockKeychainEnabled,
    noFocusEnabled,
    showWindow,
} from '../../../packages/desktop/main/testFocus.js';
import { guardedLaunchOptions } from '../../e2e/fixtures/electron.js';

const fakeWin = () => ({ show: vi.fn(), showInactive: vi.fn(), focus: vi.fn() });

describe('test launch focus option', () => {
    it('is on only for the value 1', () => {
        expect(noFocusEnabled({ XCHAIN_TEST_NO_FOCUS: '1' })).toBe(true);
        expect(noFocusEnabled({})).toBe(false);
        expect(noFocusEnabled({ XCHAIN_TEST_NO_FOCUS: '0' })).toBe(false);
        expect(noFocusEnabled({ XCHAIN_TEST_NO_FOCUS: 'true' })).toBe(false);
    });

    it('shows inactive and skips focus in test mode', () => {
        const win = fakeWin();
        showWindow(win, { XCHAIN_TEST_NO_FOCUS: '1' });
        focusWindow(win, { XCHAIN_TEST_NO_FOCUS: '1' });
        expect(win.showInactive).toHaveBeenCalledTimes(1);
        expect(win.show).not.toHaveBeenCalled();
        expect(win.focus).not.toHaveBeenCalled();
    });

    it('shows and focuses normally when unset', () => {
        const win = fakeWin();
        showWindow(win, {});
        focusWindow(win, {});
        expect(win.show).toHaveBeenCalledTimes(1);
        expect(win.showInactive).not.toHaveBeenCalled();
        expect(win.focus).toHaveBeenCalledTimes(1);
    });

    it('hides the app from the macOS Dock only in test mode', () => {
        const app = { setActivationPolicy: vi.fn(), dock: { hide: vi.fn() } };
        expect(applyTestNoFocusPolicy(app, { env: {}, platform: 'darwin' })).toBe(false);
        expect(applyTestNoFocusPolicy(app, { env: { XCHAIN_TEST_NO_FOCUS: '1' }, platform: 'linux' })).toBe(false);
        expect(app.setActivationPolicy).not.toHaveBeenCalled();
        expect(applyTestNoFocusPolicy(app, { env: { XCHAIN_TEST_NO_FOCUS: '1' }, platform: 'darwin' })).toBe(true);
        expect(app.setActivationPolicy).toHaveBeenCalledWith('accessory');
    });

    it('falls back to dock.hide when no activation policy exists', () => {
        const app = { dock: { hide: vi.fn() } };
        applyTestNoFocusPolicy(app, { env: { XCHAIN_TEST_NO_FOCUS: '1' }, platform: 'darwin' });
        expect(app.dock.hide).toHaveBeenCalledTimes(1);
    });
});

describe('test launch mock keychain option', () => {
    it('adds the switch only in test mode', () => {
        const app = { commandLine: { appendSwitch: vi.fn() } };
        expect(applyTestMockKeychain(app, { env: {} })).toBe(false);
        expect(app.commandLine.appendSwitch).not.toHaveBeenCalled();
        expect(applyTestMockKeychain(app, { env: { XCHAIN_TEST_MOCK_KEYCHAIN: '1' } })).toBe(true);
        expect(applyTestMockKeychain(app, { env: { XCHAIN_TEST_NO_FOCUS: '1' } })).toBe(true);
        expect(app.commandLine.appendSwitch).toHaveBeenCalledWith('use-mock-keychain');
        expect(app.commandLine.appendSwitch).toHaveBeenCalledTimes(2);
    });

    it('stays off for other values', () => {
        expect(mockKeychainEnabled({ XCHAIN_TEST_MOCK_KEYCHAIN: '0' })).toBe(false);
        expect(mockKeychainEnabled({})).toBe(false);
    });

    it('is set by the shared test launcher', () => {
        const options = guardedLaunchOptions({ args: ['.'] });
        expect(options.args).toContain('--use-mock-keychain');
        expect(options.env.XCHAIN_TEST_NO_FOCUS).toBe('1');
        expect(options.env.XCHAIN_TEST_MOCK_KEYCHAIN).toBe('1');
    });
});
