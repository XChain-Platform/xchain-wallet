// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Helper for the common case: wrap an XChainSDK class constructor as a
// SDKFactory that `SDKRegistry` accepts. Shells import xchain-sdk via
// whichever mechanism works for their target (Node `createRequire`,
// native ESM-of-CJS, a bundled browser build) and then pass the class
// through this adapter.
//
// Example (Node / desktop):
//
//     import { createRequire } from 'node:module';
//     const require = createRequire(import.meta.url);
//     const { XChainSDK } = require('xchain-sdk');
//
//     import { SDKRegistry } from '@xchain-wallet/core';
//     import { adaptXChainSDK } from '@xchain-wallet/core/sdk';
//
//     const sdkRegistry = new SDKRegistry({
//         chainRegistry,
//         sdkFactory: adaptXChainSDK(XChainSDK),
//     });
//
// Example (browser with bundled SDK):
//
//     import { XChainSDK } from 'xchain-sdk';  // via bundler
//     const sdkRegistry = new SDKRegistry({
//         chainRegistry,
//         sdkFactory: adaptXChainSDK(XChainSDK),
//     });

/**
 * @param {new (opts: import('./SDKRegistry.js').SDKConstructorOpts) => import('./SDKRegistry.js').XChainSDKLike} XChainSDKClass
 * @returns {import('./SDKRegistry.js').SDKFactory}
 */
export function adaptXChainSDK(XChainSDKClass) {
    if (typeof XChainSDKClass !== 'function') {
        throw new Error(
            'adaptXChainSDK: expected a class/function (got ' +
                typeof XChainSDKClass +
                ')',
        );
    }
    return (opts) => new XChainSDKClass(opts);
}
