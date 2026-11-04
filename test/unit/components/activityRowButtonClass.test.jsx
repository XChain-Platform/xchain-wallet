// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The activity row is a whole-row button on Home and in History, and it
// carries the shared Button base, one variant and one size in its markup,
// so the layout harness reads it as a kit button. The row stylesheet keeps
// its own look on top of the base and never pulls the Button sheet in
// through composes, which would ship a second copy of it in the chunk.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ActivityRow } from '../../../packages/core/src/shared/components/ActivityRow.jsx';
import rowStyles from '../../../packages/core/src/shared/components/ActivityRow.module.css';
import historyStyles from '../../../packages/core/src/shared/routes/History.module.css';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

afterEach(() => cleanup());

const VARIANTS = ['primary', 'secondary', 'ghost', 'link', 'danger', 'success'];
const SIZES = ['sm', 'md', 'lg'];

function expectKitButton(button) {
    const classes = [...button.classList];
    expect(classes).toContain(buttonStyles.btn);
    expect(VARIANTS.filter((v) => buttonStyles[v] && classes.includes(buttonStyles[v]))).toHaveLength(1);
    expect(SIZES.filter((s) => buttonStyles[s] && classes.includes(buttonStyles[s]))).toHaveLength(1);
    expect(button.getAttribute('type')).toBe('button');
    expect(classes).toContain(rowStyles.row);
}

describe('ActivityRow button classes', () => {
    it('renders the row as a shared Button with one variant and one size', () => {
        render(
            <ActivityRow
                chainId="bitcoin-regtest"
                tick="BTC"
                isNative
                label="Sent"
                amount="-0.01 BTC"
                status="confirmed"
                onClick={vi.fn()}
            />,
        );
        expectKitButton(screen.getByRole('button', { name: /Sent/ }));
    });

    it('keeps the Button classes on the History group card row', () => {
        render(
            <ActivityRow
                chainId="bitcoin-regtest"
                tick="BTC"
                isNative
                label="Launched TICK"
                amount="3 items"
                status="pending"
                onClick={vi.fn()}
                data-history-row
                aria-expanded={false}
                className={`${historyStyles.row} ${historyStyles.groupCard} `}
            />,
        );
        const button = screen.getByRole('button', { name: /Launched TICK/ });
        expectKitButton(button);
        expect(button.classList.contains(historyStyles.row)).toBe(true);
        expect(button.classList.contains(historyStyles.groupCard)).toBe(true);
        expect(button.getAttribute('aria-expanded')).toBe('false');
        expect(button.hasAttribute('data-history-row')).toBe(true);
    });

    it('keeps the Button sheet out of the row stylesheet', () => {
        const css = readFileSync(join(process.cwd(), 'packages/core/src/shared/components/ActivityRow.module.css'), 'utf8');
        expect(css).not.toMatch(/^\s*composes\s*:/m);
    });

    it('points the Button hover fill at the muted row fill, not the ghost slate', () => {
        const css = readFileSync(join(process.cwd(), 'packages/core/src/shared/components/ActivityRow.module.css'), 'utf8');
        const row = css.match(/^\.row\s*\{([^}]*)\}/m);
        expect(row).not.toBeNull();
        expect(row[1]).toMatch(/--xc-button-hover-bg:\s*var\(--xc-bg-muted\)/);
        expect(row[1]).toMatch(/--xc-button-hover-border:\s*transparent/);
    });
});
