// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §46 delivery adapter for the web shell. The in-page NotificationService
// (hosted in hostBridge.js) calls `notify({ kind, title, body, sound })`; this
// translates it to the right surface based on tab focus:
//
//   - Tab backgrounded → OS notification via the browser Notification API
//     (requires the user to have granted permission in Settings). The OS
//     notification carries the system's own sound; we play none.
//   - Tab focused → an in-app toast: we dispatch a window CustomEvent that
//     the React layer (App.jsx) listens for and renders through ToastHost,
//     and play the notification's `sound` if core resolved one. The sound
//     rides the toast's own visibility rule so it is never the sole signal
//     (wallet-unconfirmed-and-sounds §6 M4.1).
//     Showing an OS toast while the user is already looking at the wallet
//     would be noise, so we route to the in-app surface instead.
//
// Sounds are files under `public/sounds/` (never bundled, so Vite cannot
// inline them as `data:` URIs the CSP would block, I-32) and play through a
// throwaway `Audio` element. `play()` returns a promise the browser rejects
// before the page's first user gesture; the wallet cannot notify before an
// unlock, which is one, and the rejection is swallowed regardless because a
// refused ornament is not an error worth surfacing.

import { soundById } from '@xchain-wallet/core/notifications/notificationSounds.js';

/** Event name bridging the non-React adapter to the React toast layer. */
export const NOTIFICATION_EVENT = 'xchain:notification';

/** Where the palette files live, relative to the app's base URL. */
export const SOUND_DIR = 'sounds/';

/**
 * The URL a palette file is served from. Built on the app's base so a
 * sub-path deploy keeps working; the default base is `/`.
 *
 * @param {string} file  a palette entry's `file`
 * @returns {string}
 */
export function soundUrl(file) {
    let base = '/';
    try {
        const envBase = import.meta.env && import.meta.env.BASE_URL;
        if (typeof envBase === 'string' && envBase.length > 0) base = envBase;
    } catch {
        // No import.meta.env (a plain Node smoke run): root-relative is right.
    }
    if (!base.endsWith('/')) base += '/';
    return `${base}${SOUND_DIR}${file}`;
}

/**
 * Play one palette file. Never throws: no Audio API, a refused autoplay, a
 * missing file, all of them leave the toast standing and nothing else.
 *
 * @param {{ file: string } | null | undefined} sound
 * @returns {boolean} whether a play was started
 */
function playFile(sound) {
    if (!sound || typeof sound.file !== 'string' || sound.file.length === 0) return false;
    if (typeof Audio === 'undefined') return false;
    try {
        const el = new Audio(soundUrl(sound.file));
        const p = el.play();
        if (p && typeof p.catch === 'function') p.catch(() => { /* autoplay policy / decode failure: silent */ });
        return true;
    } catch {
        return false;
    }
}

/** Whether the tab is visible, which is also when the in-app toast shows (App.jsx). */
function tabVisible() {
    return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

/**
 * @returns {((n: { kind: string, title: string, body: string, sound?: { id: string, file: string } | null }) => void) & { playSound: (soundId: string) => boolean }}
 */
export function createWebNotifyAdapter() {
    function notify({ kind, title, body, sound }) {
        // In-app channel: always dispatched; the React listener decides
        // whether to show it (it only toasts when the tab is focused).
        try {
            if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
                window.dispatchEvent(new CustomEvent(NOTIFICATION_EVENT, { detail: { kind, title, body } }));
            }
        } catch {
            // Non-DOM environment (e.g. a Node smoke run); nothing to do.
        }

        // Sound: the in-app path only, so it accompanies the toast and never
        // an OS notification (which has the system's sound) or nothing at all.
        if (sound && tabVisible()) playFile(sound);

        // OS channel: only when backgrounded and permission is granted.
        try {
            if (typeof document !== 'undefined'
                && document.visibilityState === 'hidden'
                && typeof Notification !== 'undefined'
                && Notification.permission === 'granted') {
                // eslint-disable-next-line no-new
                new Notification(title, { body });
            }
        } catch {
            // Permission revoked mid-session / unsupported; silently skip.
        }
    }

    /**
     * Settings preview: play a palette sound by id with no live event and no
     * toast. `none` and unknown ids are a no-op, reported as false.
     *
     * @param {string} soundId
     * @returns {boolean} whether a play was started
     */
    notify.playSound = function playSound(soundId) {
        return playFile(soundById(soundId));
    };

    return notify;
}
