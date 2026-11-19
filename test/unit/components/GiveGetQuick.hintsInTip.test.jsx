// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// U57 on the Give/Get Quick cards: a static explanation sits in the card's
// '?' tip, never as a loose line under the card. The ownership note joins the
// tip; the host forms carry their other static notes in `help`.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { GiveGetQuick } from '../../../packages/core/src/shared/components/giveGet/GiveGetQuick.jsx';

afterEach(cleanup);

function side(label, extra = {}) {
    return {
        label,
        asset: { chainId: 'bitcoin-mainnet', tick: 'XCHAIN' },
        assetLabel: `${label} asset`,
        onOpenAsset: () => {},
        amount: '',
        onAmountChange: () => {},
        amountLabel: `${label} amount`,
        ...extra,
    };
}

const HINT = 'The matcher hands over this token name.';

describe('Give/Get Quick static hints', () => {
    it('puts the ownership note in the tip, not under the card', () => {
        render(
            <GiveGetQuick
                give={side('You give')}
                get={side('You get', { help: 'The token you want.', ownership: true, ownershipHint: HINT })}
            />,
        );
        const card = screen.getByRole('region', { name: 'You get' });
        const tip = card.querySelector('[role="tooltip"]');
        expect(tip.textContent).toContain('The token you want.');
        expect(tip.textContent).toContain(HINT);
        // Nowhere else in the card: no loose line.
        const outside = [...card.querySelectorAll('div, p, span')]
            .filter((el) => !tip.contains(el) && el !== tip && el.textContent.includes(HINT));
        expect(outside.filter((el) => !el.contains(tip))).toEqual([]);
    });

    it('gives the ownership note its own tip when the side has no help', () => {
        render(<GiveGetQuick give={side('You give', { ownership: true, ownershipHint: HINT })} get={side('You get')} />);
        const card = screen.getByRole('region', { name: 'You give' });
        expect(card.querySelector('[role="tooltip"]').textContent).toBe(HINT);
    });

    it('keeps the order and dispenser forms free of static foot lines', () => {
        const read = (name) => readFileSync(resolve(process.cwd(), `packages/core/src/shared/routes/${name}.jsx`), 'utf8');
        const order = read('CreateOrderForm');
        expect(order).not.toMatch(/the matcher pays it after the match/);
        expect(order).not.toMatch(/you pay it after a match/);
        const dispenser = read('DispenserForm');
        expect(dispenser).not.toMatch(/footNote:[^\n]*Buyers send this to the dispenser address/);
        expect(dispenser).toMatch(/Buyers send it to the dispenser address\./);
    });
});
