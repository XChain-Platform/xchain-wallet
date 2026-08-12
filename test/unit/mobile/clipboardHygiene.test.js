// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// SSC-4 clipboard hygiene.
//
// The property that matters is not "sensitive copies call the plugin". It is
// that a sensitive copy NEVER reaches the web clipboard API on a native shell.
// That fallback is the leak the contract exists to prevent - on iOS it is
// Universal Clipboard carrying a seed phrase to every nearby signed-in device -
// and it would be invisible, because a leaking copy looks exactly like a
// working one.
//
// So every test below is written from the leak's point of view: it hands the
// code a fake `navigator.clipboard` that RECORDS what it was asked to write,
// and then asserts that the secret never appears in that recording.

import { describe, it, expect } from 'vitest';
import {
    CLIPBOARD_PLUGIN_NAME,
    CopyFailure,
    SENSITIVE_CLIP_TTL_SECONDS,
    clearClipboard,
    copyText,
    getNativeClipboard,
    sensitiveCopySupported,
} from '../../../packages/core/src/shared/clipboard.js';
import { getNativePlugin, isNativeShell } from '../../../packages/core/src/shared/nativeShell.js';

const SEED = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

/** A fake environment: records every web-clipboard write, and every plugin call. */
function makeEnv({ native = false, plugin = true, throwOnWrite = false } = {}) {
    const webWrites = [];
    const pluginCalls = [];
    const env = {
        navigator: { clipboard: { writeText: async (t) => { webWrites.push(t); } } },
        webWrites,
        pluginCalls,
    };
    if (native || plugin) {
        env.Capacitor = {
            isNativePlatform: () => native,
            Plugins: plugin
                ? {
                    [CLIPBOARD_PLUGIN_NAME]: {
                        write: async (opts) => {
                            pluginCalls.push({ method: 'write', ...opts });
                            if (throwOnWrite) throw new Error('pasteboard unavailable');
                            return { ok: true };
                        },
                        clear: async () => { pluginCalls.push({ method: 'clear' }); return { ok: true }; },
                    },
                }
                : {},
        };
    }
    return env;
}

describe('a native shell with the clipboard plugin', () => {
    it('sends a sensitive copy to the plugin, marked and with a TTL', async () => {
        const env = makeEnv({ native: true });
        const res = await copyText(SEED, { sensitive: true, env });
        expect(res).toMatchObject({ ok: true, native: true });
        expect(env.pluginCalls).toEqual([{
            method: 'write', value: SEED, sensitive: true, ttlSeconds: SENSITIVE_CLIP_TTL_SECONDS,
        }]);
        // The point of the whole exercise.
        expect(env.webWrites).toEqual([]);
    });

    it('passes through whether the mark was APPLIED, not just requested', async () => {
        // Android's EXTRA_IS_SENSITIVE is 13+, so an Android 12 device marks
        // nothing and says so. A caller that wants to be honest about the
        // guarantee needs that answer; swallowing it is how a copy quietly
        // gives less than the UI implied.
        const env = makeEnv({ native: true });
        env.Capacitor.Plugins.XChainClipboard.write = async () => ({ ok: true, marked: false });
        expect(await copyText(SEED, { sensitive: true, env })).toMatchObject({ ok: true, marked: false });
    });

    it('still uses the plugin for an ordinary copy, unmarked', async () => {
        const env = makeEnv({ native: true });
        await copyText('bc1qexampleaddress', { env });
        expect(env.pluginCalls[0]).toMatchObject({ sensitive: false });
        expect(env.webWrites).toEqual([]);
    });

    it('clears through the plugin rather than pasting a space over the secret', async () => {
        // Overwriting with ' ' is what the seed screen used to do. On iOS that
        // syncs a space to every nearby device and leaves the seed in theirs.
        const env = makeEnv({ native: true });
        await clearClipboard({ env });
        expect(env.pluginCalls).toEqual([{ method: 'clear' }]);
        expect(env.webWrites).toEqual([]);
    });
});

describe('a native shell whose clipboard plugin did not register', () => {
    it('REFUSES a sensitive copy instead of leaking it through the web API', async () => {
        const env = makeEnv({ native: true, plugin: false });
        const res = await copyText(SEED, { sensitive: true, env });
        expect(res.ok).toBe(false);
        expect(res.reason).toBe(CopyFailure.NO_NATIVE_CLIPBOARD);
        expect(env.webWrites).toEqual([]);
        expect(JSON.stringify(env.webWrites)).not.toContain('legal winner');
    });

    it('says so up front, so a caller can hide the affordance', async () => {
        expect(sensitiveCopySupported(makeEnv({ native: true, plugin: false }))).toBe(false);
        expect(sensitiveCopySupported(makeEnv({ native: true }))).toBe(true);
    });

    it('still allows an ordinary copy: an address is public', async () => {
        const env = makeEnv({ native: true, plugin: false });
        const res = await copyText('bc1qexampleaddress', { env });
        expect(res).toMatchObject({ ok: true, native: false });
        expect(env.webWrites).toEqual(['bc1qexampleaddress']);
    });

    it('refuses too when the native write THROWS mid-copy', async () => {
        // A throw says nothing about whether the pasteboard is device-local, so
        // it is a refusal, not a reason to try the leaking path with a secret.
        const env = makeEnv({ native: true, throwOnWrite: true });
        const res = await copyText(SEED, { sensitive: true, env });
        expect(res.ok).toBe(false);
        expect(env.webWrites).toEqual([]);
    });

    it('falls back on a throw when the value is NOT sensitive', async () => {
        const env = makeEnv({ native: true, throwOnWrite: true });
        const res = await copyText('txid-abc', { env });
        expect(res).toMatchObject({ ok: true, native: false });
        expect(env.webWrites).toEqual(['txid-abc']);
    });
});

describe('an ordinary browser', () => {
    it('copies as it always has, sensitive or not', async () => {
        // Web, desktop and the extension have no sensitivity API to use, and no
        // cross-device pasteboard sync we are responsible for. Changing their
        // behaviour here would be inventing a guarantee we cannot keep.
        const env = makeEnv({ plugin: false });
        expect(await copyText(SEED, { sensitive: true, env })).toMatchObject({ ok: true, native: false });
        expect(env.webWrites).toEqual([SEED]);
        expect(sensitiveCopySupported(env)).toBe(true);
    });

    it('is not fooled by a page that merely defines window.Capacitor', async () => {
        // Some dApp libraries define the global. Treating that as a native
        // shell would refuse every sensitive copy in a browser.
        const env = { navigator: { clipboard: { writeText: async () => {} } }, Capacitor: {} };
        expect(isNativeShell(env)).toBe(false);
        expect(sensitiveCopySupported(env)).toBe(true);
    });

    it('reports failure rather than silence when every path is gone', async () => {
        const env = {};
        const res = await copyText('x', { env });
        expect(res).toMatchObject({ ok: false, reason: CopyFailure.UNAVAILABLE });
    });
});

describe('the plugin probe', () => {
    it('rejects a handle that does not expose the contract method', () => {
        // A half-registered plugin, or a JS proxy with no native class behind
        // it, must answer null rather than pretending.
        const env = { Capacitor: { isNativePlatform: () => true, Plugins: { XChainClipboard: {} } } };
        expect(getNativeClipboard(env)).toBeNull();
        expect(getNativePlugin('XChainClipboard', { env, method: 'write' })).toBeNull();
    });
});
