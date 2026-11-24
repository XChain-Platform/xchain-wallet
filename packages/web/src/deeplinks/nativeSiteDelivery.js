// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { deliverResult } from '../../../core/src/site_request/deliver.js';
import { LINKS_PLUGIN } from './nativeDeepLinks.js';

export function nativeLinksPlugin(env = globalThis) {
    const capacitor = env?.Capacitor;
    if (!capacitor || typeof capacitor.isNativePlatform !== 'function'
        || capacitor.isNativePlatform() !== true) return null;
    const plugin = capacitor.Plugins?.[LINKS_PLUGIN];
    return plugin !== null && typeof plugin === 'object' ? plugin : null;
}

export function nativeSiteHooks(plugin, request) {
    if (plugin === null || typeof plugin !== 'object') return {};

    const hooks = {};
    if (typeof plugin.returnToBrowser === 'function') {
        hooks.navigate = async (url) => {
            const args = { url };
            if (typeof request?.browser === 'string') args.browser = request.browser;
            try {
                await plugin.returnToBrowser(args);
            } catch (_err) {
                return undefined;
            }
        };
    }
    if (typeof plugin.post === 'function') {
        hooks.deliver = (req, outcome, options = {}) => deliverResult(req, outcome, {
            ...options,
            post: async ({ href, address, body, timeoutMs, redirect, credentials }) => {
                const answer = await plugin.post({
                    href,
                    address,
                    body,
                    timeoutMs,
                    redirect,
                    credentials,
                });
                if (!Number.isInteger(answer?.status)) {
                    throw new Error('Native callback returned an invalid status');
                }
                return { status: answer.status };
            },
        });
    }
    return hooks;
}
