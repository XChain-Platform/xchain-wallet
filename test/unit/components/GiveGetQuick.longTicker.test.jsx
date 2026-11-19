// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A picked token fits inside the Give/Get asset chip: a long ticker ends in
// an ellipsis inside the chip while the icon (with its network badge) and the
// chevron keep their size and place.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { GiveGetQuick } from '../../../packages/core/src/shared/components/giveGet/GiveGetQuick.jsx';
import styles from '../../../packages/core/src/shared/components/giveGet/GiveGet.module.css';

const CSS = readFileSync(join(process.cwd(), 'packages/core/src/shared/components/giveGet/GiveGet.module.css'), 'utf8');
// The declarations of one top-level rule, as { property: value }.
function rule(selector) {
    const body = CSS.match(new RegExp(`(?:^|\\n)${selector.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`))?.[1] || '';
    const out = {};
    for (const decl of body.replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
        const i = decl.indexOf(':');
        if (i > 0) out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
    }
    return out;
}

const LONG_TICK = 'ABCDEFGHIJKL';

function side(tick, label) {
    return {
        label,
        asset: { chainId: 'bitcoin-mainnet', tick },
        assetLabel: `${label} asset`,
        onOpenAsset: () => {},
        amount: '',
        onAmountChange: () => {},
        amountLabel: `${label} amount`,
    };
}

afterEach(cleanup);

describe('Give/Get asset chip with a long ticker', () => {
    it('renders a 12-character ticker in the truncating slot, between a fixed icon and a fixed chevron', () => {
        render(<GiveGetQuick give={side(LONG_TICK, 'You give')} get={side('BTC', 'You get')} />);
        const chip = screen.getByRole('button', { name: `You give asset: ${LONG_TICK} on Bitcoin` });
        expect(chip.className).toContain(styles.assetChip);

        const parts = [...chip.children];
        expect(parts).toHaveLength(3);
        const [icon, tick, caret] = parts;
        // The icon never shrinks, so its network badge stays whole.
        expect(icon.getAttribute('role')).toBe('img');
        expect(icon.style.flex).toBe('0 0 auto');
        // The ticker is the only part that gives way, and keeps the full name as its tooltip.
        expect(tick.className).toBe(styles.assetTick);
        expect(tick.textContent).toBe(LONG_TICK);
        expect(tick.getAttribute('title')).toBe(LONG_TICK);
        expect(caret.className).toBe(styles.chipCaret);
        expect(caret.getAttribute('aria-hidden')).toBe('true');
    });

    it('keeps every rule the truncation depends on', () => {
        const chip = rule('.assetChip');
        // The chip is capped and may shrink below its content, on one line.
        expect(chip['max-width']).toBeTruthy();
        expect(chip['min-width']).toBe('0');
        expect(chip['white-space']).toBe('nowrap');
        expect(chip.display).toBe('inline-flex');

        const tick = rule('.assetTick');
        expect(tick['min-width']).toBe('0');
        expect(tick.overflow).toBe('hidden');
        expect(tick['text-overflow']).toBe('ellipsis');
        // A shrink factor of 0 would push the chevron out of the chip.
        expect(tick.flex ?? '0 1 auto').not.toMatch(/^\S+\s+0\b/);

        const caret = rule('.chipCaret');
        expect(caret.flex).toBe('0 0 auto');

        // The amount beside the chip yields its room rather than pushing the chip out.
        const amount = rule('.bigAmount');
        expect(amount['min-width']).toBe('0');
        expect(rule('.cardMid')['min-width']).toBe('0');
    });
});
