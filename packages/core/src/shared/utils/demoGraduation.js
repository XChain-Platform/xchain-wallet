// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

/**
 * Demo-mode exit primitives, shared by every escape from the throwaway
 * demo wallet (wallet E2E session 16, D-61 / D-62).
 *
 * Why one module: the vault has ONE password. `meta.kdfParams` is
 * written once, when the vault is created, and the master key that
 * decrypts every wallet record in it is derived from that password
 * alone. In the demo funnel the vault is created by the demo, so the
 * password governing the whole device is the demo's random throwaway
 * one, which the exit (and the 24h auto-wipe) deletes.
 *
 * Two consequences, and both used to strand the user:
 *   - Removing the demo wallet without clearing the vault store leaves
 *     a meta the shell reads as "a wallet exists", so the next boot is
 *     an unlock screen for an empty vault whose only password was just
 *     deleted.
 *   - A REAL wallet added from inside the demo lands in that same
 *     demo-keyed vault. Its own `encryptedSeed` uses the password the
 *     user chose, but the container around it does not, so once the
 *     demo is gone the chosen password is refused and the wallet is
 *     unreachable on that device.
 *
 * The fix for the second one is to refuse to grow a demo vault: the
 * add-wallet lane graduates out of the demo first (clearing it) so the
 * real wallet creates its own vault, keyed to the user's own password.
 * `setPostDemoIntent` carries which lane the user picked across the
 * reload that the wipe requires.
 */

import { clearDemoWalletId } from '../../flows/demoMode.js';
import { clearLastView } from './lastViewMemory.js';
import { wipeWalletStorage } from './wipeWalletStorage.js';

/** localStorage slot holding the onboarding lane to resume after a demo wipe. */
export const POST_DEMO_INTENT_KEY = 'xc:postDemoOnboardingStep';

/** The onboarding steps a graduation may resume into. */
export const POST_DEMO_INTENTS = ['create', 'import', 'import-freewallet'];

/**
 * Remember which onboarding lane to open once the demo has been wiped
 * and the page has reloaded. Unknown values are dropped rather than
 * stored so a stale/handcrafted entry cannot route the shell into a
 * view it has no case for.
 *
 * @param {string} step
 */
export function setPostDemoIntent(step) {
    if (!POST_DEMO_INTENTS.includes(step)) return;
    try {
        globalThis.localStorage?.setItem(POST_DEMO_INTENT_KEY, step);
    } catch { /* best-effort: the user just lands on Welcome instead */ }
}

/**
 * Read-and-clear the pending onboarding lane. One-shot on purpose: a
 * lane that survived its own reload would hijack every later visit to
 * the Welcome screen.
 *
 * @returns {'create' | 'import' | 'import-freewallet' | null}
 */
export function takePostDemoIntent() {
    let raw = null;
    try {
        raw = globalThis.localStorage?.getItem(POST_DEMO_INTENT_KEY) || null;
        globalThis.localStorage?.removeItem(POST_DEMO_INTENT_KEY);
    } catch {
        return null;
    }
    return POST_DEMO_INTENTS.includes(raw) ? /** @type {any} */ (raw) : null;
}

/**
 * True when the add-a-wallet lane is running against a vault the demo
 * created, i.e. a vault whose unlock password is the demo's throwaway
 * one. Anything added here would be locked behind a password the user
 * never chose and that the demo deletes on the way out.
 *
 * @param {{ mode?: string, demoWalletId?: string | null }} [opts]
 * @returns {boolean}
 */
export function demoOwnsVaultPassword({ mode, demoWalletId } = {}) {
    return mode === 'add' && typeof demoWalletId === 'string' && demoWalletId.length > 0;
}

/**
 * What is left in the vault, as three distinct answers rather than a
 * boolean. "Nothing is left" and "we could not tell" call for opposite
 * follow-ups: the first is safe to wipe, the second is safe to do
 * nothing about, and collapsing them into `false` hides that.
 *
 * @param {any} messaging
 * @returns {Promise<'empty' | 'occupied' | 'unknown'>}
 */
export async function readVaultOccupancy(messaging) {
    if (typeof messaging?.listWallets !== 'function') return 'unknown';
    try {
        const list = await messaging.listWallets();
        const arr = Array.isArray(list) ? list : list?.wallets;
        if (!Array.isArray(arr)) return 'unknown';
        return arr.length === 0 ? 'empty' : 'occupied';
    } catch {
        return 'unknown';
    }
}

/**
 * True when the vault holds no wallet records. Fails CLOSED (returns
 * false) if the list can't be read: not wiping leaves a recoverable
 * mess, wiping a vault we could not inspect does not.
 *
 * @param {any} messaging
 * @returns {Promise<boolean>}
 */
export async function isVaultEmpty(messaging) {
    return (await readVaultOccupancy(messaging)) === 'empty';
}

/** @returns {boolean} whether the reload actually happened */
function defaultReload() {
    if (typeof globalThis !== 'undefined' && globalThis.location?.reload) {
        globalThis.location.reload();
        return true;
    }
    return false;
}

/**
 * @typedef {Object} ExitDemoResult
 * @property {boolean} wiped      the vault store was cleared (demo was the last wallet)
 * @property {boolean} reloaded   the page reload was issued; the caller should stop
 * @property {'empty' | 'occupied' | 'unknown'} remaining   what the vault held once the demo record was gone
 */

/**
 * Remove the demo wallet and, when it was the last one in the vault,
 * clear the vault store so the next boot lands on Welcome instead of
 * an unlock screen for an empty vault.
 *
 * Every demo escape routes through here (Wallet details, the 24h
 * auto-expire, and the add-wallet graduation) so the three cannot
 * drift apart.
 *
 * @param {object} opts
 * @param {any} opts.messaging
 * @param {string} opts.walletId                            the demo wallet
 * @param {string | null} [opts.intent]                     onboarding lane to resume after the reload
 * @param {() => Promise<void>} [opts.wipe]                 injected for tests
 * @param {() => boolean} [opts.reload]                     injected for tests
 * @returns {Promise<ExitDemoResult>}
 */
export async function exitDemoWallet({
    messaging,
    walletId,
    intent = null,
    wipe = wipeWalletStorage,
    reload = defaultReload,
}) {
    if (typeof walletId !== 'string' || walletId.length === 0) {
        throw new Error('exitDemoWallet: walletId is required');
    }
    if (typeof messaging?.removeWallet === 'function') {
        await messaging.removeWallet({ walletId });
    } else if (typeof messaging?.sendMessage === 'function') {
        await messaging.sendMessage('wallet.remove', { walletId });
    }
    clearDemoWalletId();
    clearLastView(walletId);

    // Only when nothing else is left: a real wallet alongside the demo
    // means the vault is still the user's, and wiping it would destroy
    // it. An unreadable list reads as 'unknown' and never triggers a
    // wipe either.
    const remaining = await readVaultOccupancy(messaging);
    if (remaining !== 'empty') return { wiped: false, reloaded: false, remaining };

    if (intent) setPostDemoIntent(intent);
    await wipe();
    return { wiped: true, reloaded: reload(), remaining };
}
