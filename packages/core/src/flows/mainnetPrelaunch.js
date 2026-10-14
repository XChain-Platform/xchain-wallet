// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Mainnet prelaunch refusal. Before MAINNET_LAUNCH_EPOCH (unix seconds) the
// wallet refuses to submit an XChain action on any `*-mainnet` chain. A bare
// native-coin payment is not an XChain action (it carries no action string),
// so it stays allowed. Sits beside assertSigningAllowed in submitWithSigner
// and in the queued re-broadcast drain.

import { isBareNativePayment } from './nativePayment.js';

export const MAINNET_LAUNCH_EPOCH = 1798761600;

export class MainnetPrelaunchError extends Error {
    constructor(chainId) {
        super(`XChain actions are not available on ${chainId} before mainnet launch`);
        this.name = 'MainnetPrelaunchError';
        this.code = 'MAINNET_PRELAUNCH';
        this.chainId = chainId;
    }
}

export function isMainnetChainId(chainId) {
    return typeof chainId === 'string' && chainId.endsWith('-mainnet');
}

/**
 * Throw MainnetPrelaunchError for a non-bare XChain action on a mainnet chain
 * before launch. `now` is injectable (ms since epoch) for tests.
 *
 * @param {{ chainId: string, actionData: object | null, descriptor?: object | null, now?: number }} opts
 */
export function assertMainnetActionAllowed({ chainId, actionData, descriptor, now = Date.now() }) {
    if (!isMainnetChainId(chainId)) return;
    if (now >= MAINNET_LAUNCH_EPOCH * 1000) return;
    if (isBareNativePayment(actionData, descriptor)) return;
    throw new MainnetPrelaunchError(chainId);
}
