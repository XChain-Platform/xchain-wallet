// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const strings = JSON.parse(readFileSync(join(
    process.cwd(),
    'packages/core/src/watch/contract/strings-alerts.json',
), 'utf8'));

describe('watch alert strings', () => {
    it('contains every W3 and W4 string', () => {
        expect(strings).toEqual({
            'w3.title': 'Alerts',
            'w3.empty': 'No alerts',
            'w3.timeJustNow': 'Just now',
            'w3.timeMinutes': '{n} min ago',
            'w3.timeHours': '{n} h ago',
            'w3.timeDays': '{n} d ago',
            'w4.title': 'Alert detail',
            'w4.requestSentence': 'Request',
            'w4.requestAmount': 'Amount',
            'w4.requestExpiry': 'Expires',
            'w4.requestExpired': 'This request expired.',
            'w4.openOnPhone': 'Open on phone',
        });
    });

    it('uses only the W3 and W4 namespaces without em dashes', () => {
        expect(Object.keys(strings).every((key) => /^w[34]\./.test(key))).toBe(true);
        expect(Object.values(strings).some((value) => value.includes('\u2014'))).toBe(false);
    });
});
