// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// These screens once drew their error notice with a local class or a raw
// element. Every one now renders through <StatusMessage variant="error">, so
// the look and the live-region role come from one place. This guards the
// seven from slipping back to a local error class or a raw alert element.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const shared = join(process.cwd(), 'packages/core/src/shared');
const FILES = [
    'routes/AddAddressModal',
    'routes/AddressList',
    'routes/ManageToken',
    'routes/History',
    'routes/Loading',
    'components/QueuedBroadcastBanner',
    'components/BalanceChanges',
];

describe('error notices render through StatusMessage', () => {
    for (const name of FILES) {
        it(`${name} has no local error class or raw alert`, () => {
            const source = readFileSync(join(shared, `${name}.jsx`), 'utf8');
            const css = readFileSync(join(shared, `${name}.module.css`), 'utf8');
            expect(source).not.toMatch(/styles\.error\b/);
            expect(source).not.toMatch(/<(div|p|span)[^>]*role="alert"[^>]*className=\{styles\.error/);
            expect(css).not.toMatch(/^\.error\b/m);
            // A shared primitive draws the message: a StatusMessage notice, or a
            // FieldNote for a message about one item in a summary.
            expect(source).toMatch(/\b(?:StatusMessage|FieldNote)\b/);
        });
    }
});
