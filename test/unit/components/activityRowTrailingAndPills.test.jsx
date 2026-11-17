// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// An activity row with no trailing control draws no trailing cell and drops
// that grid column; its status pills are outlined, with a stronger tint, and
// every colour comes from a token.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ActivityRow } from '../../../packages/core/src/shared/components/ActivityRow.jsx';
import rowStyles from '../../../packages/core/src/shared/components/ActivityRow.module.css';

afterEach(() => cleanup());

const css = readFileSync('packages/core/src/shared/components/ActivityRow.module.css', 'utf8');

function ruleBody(selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? null;
}

function gridRows(body) {
    const areas = /grid-template-areas:\s*([^;]+);/s.exec(body || '')?.[1] || '';
    return [...areas.matchAll(/"([^"]+)"/g)].map((match) => match[1].split(/\s+/));
}

function renderRow(props = {}) {
    return render(
        <ActivityRow
            chainId="bitcoin-regtest"
            tick="BTC"
            isNative
            label="Sent"
            amount="-0.01 BTC"
            status="confirmed"
            block="Block 12"
            timestamp={1_700_000_000}
            onClick={vi.fn()}
            {...props}
        />,
    );
}

describe('ActivityRow trailing column', () => {
    it('drops the trailing cell and column when the row has no trailing control', () => {
        const { container } = renderRow();
        const row = container.querySelector('button');
        expect(row).toHaveClass(rowStyles.noTrailing);
        expect(container.querySelector(`.${rowStyles.trailing}`)).toBeNull();
    });

    it('keeps the trailing cell and column when a control is given', () => {
        const { container } = renderRow({ trailing: <span data-testid="chevron">&gt;</span> });
        const row = container.querySelector('button');
        expect(row).not.toHaveClass(rowStyles.noTrailing);
        const cell = container.querySelector(`.${rowStyles.trailing}`);
        expect(cell).not.toBeNull();
        expect(cell.querySelector('[data-testid="chevron"]')).not.toBeNull();
    });

    it('lays the no-trailing row out on four columns with no trailing area', () => {
        const body = ruleBody('.row.row.noTrailing');
        expect(body).not.toBeNull();
        expect(body).toMatch(/grid-template-columns:\s*auto minmax\(3rem, 1fr\) auto auto;/);
        expect(gridRows(body)).toEqual([
            ['mark', 'label', 'label', 'status'],
            ['mark', 'primary', 'primary', 'primary'],
            ['mark', 'block', 'block', 'time'],
        ]);
    });
});

describe('ActivityRow status pills', () => {
    it.each([
        ['confirmed', '--xc-success-fill', '--xc-success-bg'],
        ['pending', '--xc-warning', '--xc-warning-bg'],
        ['failed', '--xc-danger', '--xc-danger-bg'],
    ])('outlines the %s pill with a 1px token border and a token tint', (status, outline, fallback) => {
        const body = ruleBody(`.status.${status}`);
        expect(body).not.toBeNull();
        expect(body).toContain(`border: 1px solid var(${outline});`);
        // The plain tint comes first so a browser without color-mix() still fills the pill.
        const plain = body.indexOf(`background: var(${fallback});`);
        const mixed = body.search(new RegExp(`background: color-mix\\(in srgb, var\\(${outline}\\) \\d+%, transparent\\);`));
        expect(plain).toBeGreaterThanOrEqual(0);
        expect(mixed).toBeGreaterThan(plain);
    });

    it('keeps every status text colour on a token', () => {
        expect(ruleBody('.confirmed')).toMatch(/color:\s*var\(--xc-success\);/);
        expect(ruleBody('.pending')).toMatch(/color:\s*var\(--xc-warning\);/);
        expect(ruleBody('.failed')).toMatch(/color:\s*var\(--xc-danger-fg\);/);
    });

    it('uses no raw colour and no :has() selector', () => {
        const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
        expect(withoutComments).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(withoutComments).not.toMatch(/\brgba?\(/);
        expect(withoutComments).not.toMatch(/\bhsla?\(/);
        expect(withoutComments).not.toMatch(/:has\(/);
    });
});
