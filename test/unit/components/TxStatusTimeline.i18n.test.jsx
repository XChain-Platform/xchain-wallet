// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { TxStatusTimeline } from '../../../packages/core/src/shared/components/TxStatusTimeline.jsx';
import { registerLocale, setLocale } from '../../../packages/core/src/i18n/index.js';
import pseudoRtl from '../../../packages/core/src/i18n/locales/pseudo-rtl/index.js';

const WRAPPED_PREFIX = '\u200f⟦';

function expectVisibleCopyWrapped(rawValues = []) {
    const rows = screen.getByRole('list').querySelectorAll('li');
    for (const row of rows) {
        const body = Array.from(row.children).find((child) => child.tagName === 'DIV');
        const [heading, sub] = body.children;
        const values = [heading.children[0].textContent, heading.children[1].textContent, sub.textContent];
        for (const value of values.filter(Boolean)) {
            expect(value.startsWith(WRAPPED_PREFIX) || rawValues.includes(value)).toBe(true);
        }
    }
}

afterEach(async () => {
    cleanup();
    await setLocale('en');
});

describe('TxStatusTimeline translations', () => {
    it('routes labels, state text, and explanatory copy through the active locale', async () => {
        registerLocale('pseudo-rtl', pseudoRtl);
        await setLocale('pseudo-rtl');
        const { rerender } = render(
            <TxStatusTimeline entry={{ txHash: '', blockIndex: 0, timestamp: 0 }} />,
        );
        expectVisibleCopyWrapped();

        rerender(<TxStatusTimeline entry={{
            txHash: '', blockIndex: 0, timestamp: 0, pending: { failed: true },
        }} />);
        expectVisibleCopyWrapped();

        const txHash = 'abc123';
        rerender(<TxStatusTimeline entry={{
            txHash, blockIndex: 0, timestamp: 0,
            pending: { origin: 'mempool', firstSeenMs: Date.now(), lastMempoolSeenMs: Date.now() },
        }} />);
        expectVisibleCopyWrapped([txHash]);

        rerender(<TxStatusTimeline entry={{ txHash, blockIndex: 100, timestamp: 0 }} />);
        expectVisibleCopyWrapped([txHash]);
    });
});
