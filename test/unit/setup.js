// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Vitest setup for the unit test layer.
//
// Re-exports the workspace setup so unit tests don't have to know
// where the polyfills + matcher extensions live. Future per-layer
// setups (chaos has fault injectors, security has a stricter CSP
// shim, etc.) sit in their own setup files; unit stays minimal.

import { afterEach, beforeEach } from 'vitest';

import '../setup.js';
import { CONSOLE_ERROR_ALLOWLIST } from './consoleErrorAllowlist.js';
import {
    formatConsoleArguments,
    REACT_ACT_WARNING,
    unexpectedConsoleCalls,
} from './consoleErrorGuard.js';

let consoleCalls;
let originalConsoleError;
let originalConsoleWarn;
let testIdentity;

beforeEach(({ task }) => {
    consoleCalls = [];
    testIdentity = { file: task.file.name, name: task.name };
    originalConsoleError = console.error;
    originalConsoleWarn = console.warn;
    console.error = (...args) => {
        consoleCalls.push({ level: 'error', message: formatConsoleArguments(args) });
    };
    console.warn = (...args) => {
        const message = formatConsoleArguments(args);
        consoleCalls.push({ level: 'warn', message });
        if (!REACT_ACT_WARNING.test(message)) {
            originalConsoleWarn(...args);
        }
    };
});

// Wallet modes the shell (or a test) published, or a reader merged from a
// wallet list, live in a module store; one test's wallets must not decide the
// next test's mode. Imported here, after the test file's mocks are in place,
// so a file that mocks the hook module keeps its mock (and may have no reset).
afterEach(async () => {
    try {
        const store = await import('../../packages/core/src/shared/hooks/useWalletMode.js');
        store.resetWalletModes?.();
    } catch { /* mocked module without a reset */ }
    // A form's Advanced choices (fee bumping, chosen coins, change address)
    // live in a module store too, keyed by form and source address.
    try {
        const advanced = await import('../../packages/core/src/shared/components/formStandard/advancedOptions.js');
        advanced.resetAdvancedStore?.();
    } catch { /* mocked module without a reset */ }
    // A clean load saves its read, and a saved read under five minutes old
    // answers the next mount without a request; no test inherits another's.
    try {
        const store = globalThis.localStorage;
        for (let i = (store?.length ?? 0) - 1; i >= 0; i -= 1) {
            const key = store.key(i);
            if (key?.startsWith('xc:balanceCache:') || key?.startsWith('xc:ownedTokens:')) store.removeItem(key);
        }
        const freshness = await import('../../packages/core/src/shared/utils/walletDataFreshness.js');
        freshness._resetWalletDataStale?.();
    } catch { /* no DOM storage, or a mocked module */ }
});

afterEach(() => {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    // Session-scoped UI state (History's remembered filters) would otherwise
    // carry from one test into the next within a file.
    try { globalThis.sessionStorage?.clear(); } catch { /* no DOM storage */ }

    const unexpected = unexpectedConsoleCalls(
        consoleCalls,
        testIdentity,
        CONSOLE_ERROR_ALLOWLIST,
    );
    if (unexpected.length > 0) {
        const details = unexpected
            .map(({ level, message }) => `console.${level}: ${message}`)
            .join('\n\n');
        throw new Error(`Unexpected console output in "${testIdentity.name}":\n\n${details}`);
    }
});
