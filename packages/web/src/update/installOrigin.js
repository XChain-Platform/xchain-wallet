// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Which lane installed this copy of the app ( §6, D4).
//
// One question, asked of the native shell: is anything keeping this install up
// to date? The answer gates the update notice and nothing else.
//
// THE DEFAULT IS 'unknown', AND 'unknown' IS SILENT. Only an explicit `direct`
// from a native plugin that implements `getInstallOrigin` turns the notice on.
// Everything else - a browser, the extension, the desktop app, an iOS build
// whose plugin has no such method, a native call that throws - lands on
// `unknown` and shows nothing. That asymmetry is the point: the failure mode
// of a wrong `unknown` is a sideloader who misses a notice they can still get
// from the website, and the failure mode of a wrong `direct` is an in-app
// "download an update" prompt inside a store build, which is a review problem
// on both stores.

import { callNativeVault, getNativeVault } from '../storage/nativeVault.js';

/** @typedef {'direct' | 'store' | 'unknown'} InstallChannel */

/**
 * Ask the native shell which lane installed this build.
 *
 * @returns {Promise<{ channel: InstallChannel, installer: string | null }>}
 */
export async function getInstallOrigin() {
    const plugin = getNativeVault();
    // Asked before the call rather than relying on the throw, so a shell
    // without the method is a plain answer instead of a caught exception.
    if (!plugin || typeof plugin.getInstallOrigin !== 'function') {
        return { channel: 'unknown', installer: null };
    }
    try {
        const reply = await callNativeVault('getInstallOrigin');
        const channel = reply?.channel;
        if (channel !== 'direct' && channel !== 'store') {
            // A native side that grows a third answer we do not understand is
            // NOT treated as direct. Same rule as the vault's read statuses:
            // an unrecognised status is never quietly mapped onto a
            // user-visible behaviour.
            return { channel: 'unknown', installer: null };
        }
        const installer = typeof reply.installer === 'string' ? reply.installer : null;
        return { channel, installer };
    } catch (_err) {
        return { channel: 'unknown', installer: null };
    }
}

/**
 * @param {{ channel: InstallChannel }} origin
 * @returns {boolean} whether this install has to look after its own updates
 */
export function isSelfUpdatingLane(origin) {
    return origin?.channel === 'direct';
}
