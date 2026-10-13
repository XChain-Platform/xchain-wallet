// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';

import {
    formatConsoleArguments,
    unexpectedConsoleCalls,
} from './consoleErrorGuard.js';

describe('unit console error guard', () => {
    it('rejects console errors and React act warnings', () => {
        const calls = [
            { level: 'error', message: 'request failed' },
            { level: 'warn', message: 'An update was not wrapped in act(...)' },
            { level: 'warn', message: 'The current testing environment is not configured to support act(...)' },
            { level: 'warn', message: 'expected deprecation notice' },
        ];

        const test = { file: '/repo/test/unit/guard.test.js', name: 'guard test' };
        expect(unexpectedConsoleCalls(calls, test, [])).toEqual(calls.slice(0, 3));
    });

    it('allows only the matching test and message', () => {
        const calls = [{ level: 'error', message: 'known widget failure: unavailable' }];
        const allowlist = [{
            file: 'test/unit/widget.test.js',
            test: 'widget fallback',
            message: /^known widget failure:/,
        }];
        const matchingTest = {
            file: '/repo/test/unit/widget.test.js',
            name: 'widget fallback',
        };
        const otherFile = { file: '/repo/test/unit/other.test.js', name: 'widget fallback' };

        expect(unexpectedConsoleCalls(calls, matchingTest, allowlist)).toEqual([]);
        expect(unexpectedConsoleCalls(calls, otherFile, allowlist)).toEqual(calls);
    });

    it('formats errors and structured arguments for the failure', () => {
        const message = formatConsoleArguments(['failed:', new Error('boom'), { retry: false }]);

        expect(message).toContain('failed: Error: boom');
        expect(message).toContain('{"retry":false}');
    });
});
