// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { neutralizeControlText } from '../shared/utils/textHardening.js';

export const LINK_APP_NAME_MAX = 64;

function httpOrigin(value) {
    if (typeof value !== 'string') return null;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' || url.protocol === 'http:'
            ? url.origin
            : null;
    } catch {
        return null;
    }
}

/**
 * Return the HTTP(S) origin that receives the answer to a link request.
 *
 * @param {unknown} envelope
 * @returns {string | null}
 */
export function linkAnswerOrigin(envelope) {
    if (envelope === null || typeof envelope !== 'object') return null;
    const returnOrigin = httpOrigin(envelope.return);
    const callbackOrigin = httpOrigin(envelope.callback);
    if (returnOrigin && callbackOrigin && returnOrigin !== callbackOrigin) return null;
    return returnOrigin || callbackOrigin;
}

/**
 * Return the optional display-safe application name for a link request.
 *
 * @param {unknown} envelope
 * @returns {string | null}
 */
export function linkAppName(envelope) {
    if (envelope === null || typeof envelope !== 'object') return null;
    if (envelope.app === null || typeof envelope.app !== 'object') return null;
    if (typeof envelope.app.name !== 'string') return null;
    const name = neutralizeControlText(envelope.app.name, { maxLength: LINK_APP_NAME_MAX });
    return name || null;
}

/**
 * Identify a login that can complete only through a server callback.
 *
 * @param {unknown} envelope
 * @returns {boolean}
 */
export function isAnotherDeviceLogin(envelope) {
    if (envelope === null || typeof envelope !== 'object') return false;
    return envelope.method === 'login'
        && typeof envelope.callback === 'string'
        && envelope.callback.length > 0
        && envelope.return === undefined;
}
