// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

export { MockXChainProvider } from './mock-provider.js';
export type { MockProviderOptions } from './mock-provider.js';
export {
    runExample,
    runErrorScenarios,
    handleSignActionResult,
    signActionWithRetry,
} from './example.js';
export type {
    ExampleReport,
    ErrorScenarioReport,
    SignActionUiOutcome,
} from './example.js';
