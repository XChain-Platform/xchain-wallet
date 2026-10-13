// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

export const REACT_ACT_WARNING = /(?:not wrapped in act\(|configured to support act\()/i;

export function formatConsoleArguments(args) {
    return args.map((value) => {
        if (value instanceof Error) return value.stack || value.message;
        if (typeof value === 'string') return value;
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }).join(' ');
}

export function unexpectedConsoleCalls(calls, test, allowlist) {
    return calls.filter((call) => {
        if (call.level === 'warn' && !REACT_ACT_WARNING.test(call.message)) return false;
        return !allowlist.some((entry) => test.file.endsWith(entry.file)
            && entry.test === test.name
            && entry.message.test(call.message));
    });
}
