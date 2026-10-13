// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Each entry identifies output that is an intentional part of one test.
// Keep messages specific so nearby React warnings still fail the test.
export const CONSOLE_ERROR_ALLOWLIST = [
    {
        file: 'test/unit/shared/messaging.test.js',
        test: 'throws when used outside MessagingProvider',
        message: /^Error: useMessaging must be used inside <MessagingProvider>\./,
    },
    {
        file: 'test/unit/shared/messaging.test.js',
        test: 'throws when used outside MessagingProvider',
        message: /^The above error occurred in the <TestComponent> component:/,
    },
    {
        file: 'test/unit/components/MarketChart.fallback.test.jsx',
        test: 'shows user-facing fallback copy with a valid theme token',
        message: /^\[MarketChart\] init failed: Error: \[vitest\] There was an error when mocking a module/,
    },
];
