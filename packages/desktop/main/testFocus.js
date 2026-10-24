// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Test launches must not take the keyboard focus or pop a window in front of
// the person using the machine. XCHAIN_TEST_NO_FOCUS=1, set only by test
// launchers, makes every window reveal inactive, skips explicit focus calls
// and keeps the app out of the macOS Dock. With the variable unset, nothing
// here changes what a user sees.

export const NO_FOCUS_ENV = 'XCHAIN_TEST_NO_FOCUS';

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
export function noFocusEnabled(env = process.env) {
    return env?.[NO_FOCUS_ENV] === '1';
}

/**
 * Show a window; inactive when the test option is on.
 *
 * @param {{ show: () => void, showInactive?: () => void }} win
 * @param {Record<string, string | undefined>} [env]
 */
export function showWindow(win, env = process.env) {
    if (noFocusEnabled(env) && typeof win.showInactive === 'function') win.showInactive();
    else win.show();
}

/**
 * Focus a window unless the test option is on.
 *
 * @param {{ focus: () => void }} win
 * @param {Record<string, string | undefined>} [env]
 */
export function focusWindow(win, env = process.env) {
    if (!noFocusEnabled(env)) win.focus();
}

/**
 * Keep the app out of the macOS Dock and never activated when the option is
 * on. Other platforms and the unset case do nothing.
 *
 * @param {{ setActivationPolicy?: (policy: string) => void, dock?: { hide?: () => void } }} app
 * @param {{ env?: Record<string, string | undefined>, platform?: string }} [options]
 * @returns {boolean} true when the app was hidden from the Dock
 */
export function applyTestNoFocusPolicy(app, { env = process.env, platform = process.platform } = {}) {
    if (!noFocusEnabled(env) || platform !== 'darwin') return false;
    if (typeof app?.setActivationPolicy === 'function') app.setActivationPolicy('accessory');
    else app?.dock?.hide?.();
    return true;
}

export const MOCK_KEYCHAIN_ENV = 'XCHAIN_TEST_MOCK_KEYCHAIN';
export const MOCK_KEYCHAIN_SWITCH = 'use-mock-keychain';

/**
 * Test mode is either test variable. It never holds in a normal launch.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
export function mockKeychainEnabled(env = process.env) {
    return env?.[MOCK_KEYCHAIN_ENV] === '1' || noFocusEnabled(env);
}

/**
 * Point safeStorage at Chromium's mock keychain so a test launch never reads
 * or prompts for the real app's Keychain item. Must run before app ready.
 *
 * @param {{ commandLine?: { appendSwitch?: (name: string) => void } }} app
 * @param {{ env?: Record<string, string | undefined> }} [options]
 * @returns {boolean} true when the switch was added
 */
export function applyTestMockKeychain(app, { env = process.env } = {}) {
    if (!mockKeychainEnabled(env) || typeof app?.commandLine?.appendSwitch !== 'function') return false;
    app.commandLine.appendSwitch(MOCK_KEYCHAIN_SWITCH);
    return true;
}
