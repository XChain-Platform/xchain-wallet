// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The SDK is STATICALLY imported into the MV3 service worker.
//
// `import()` is disallowed on ServiceWorkerGlobalScope by the HTML
// specification (https://github.com/w3c/ServiceWorker/issues/1356), so the
// dynamic import this module replaces ALWAYS rejected inside the packaged
// extension - for the bare `xchain-sdk` specifier and equally for the
// concrete bundled chunk path rollup emitted. Every consumer then hit the
// fail-closed guard ('xchain-sdk is not loaded yet... refusing to
// serve data'), so the extension could not create a wallet, sign, or serve
// data at all. The SDK was present in dist/ the whole time, which is why
// check-no-dev-mock.sh reported a healthy bundle: that gate proves the SDK
// was BUNDLED, never that the worker can REACH it.
//
// The web shell runs the same resolver in-page (packages/web/hostBridge.js),
// where dynamic import is perfectly legal - identical source, one legal
// context and one illegal one - which is why only the extension was
// affected and why nothing short of driving the packaged extension could
// have caught it.
//
// It lives in its own module, and deliberately NOT in sdkFactory.js or the
// ./index.js barrel, so `createDevMockSdk` stays importable from Node
// harnesses that have no xchain-sdk available: test/smoke/shells/
// desktop-keychain.smoke.js and test/smoke/onboarding/
// extension-onboarding.smoke.js both import sdkFactory.js directly.

import * as sdkModule from 'xchain-sdk';

/**
 * The real SDK class. Undefined only if the package's export shape changes,
 * which `resolveSdkFactory` reports as a hard failure rather than papering
 * over with the dev mock.
 */
export const XChainSDK = sdkModule?.XChainSDK
    ?? sdkModule?.default?.XChainSDK
    ?? sdkModule?.default;
