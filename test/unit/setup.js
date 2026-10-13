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

afterEach(() => {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;

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
