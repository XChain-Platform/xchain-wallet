// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// G113: Speed and Fees has one custom fee editor, the Network fee line.
// Sliding to Custom opens that line's editor in place; no second fee or rate
// box ever appears under the slider.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useMemo, useState } from 'react';

import { customFeeEstimate, estimateNativeSendFeeTiers } from '../../../packages/core/src/flows/feeEstimate.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { FeeSection } from '../../../packages/core/src/shared/components/formStandard/index.js';
import { feeForRate } from '../../helpers/customNetworkFee.js';

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings: { fiatCurrency: 'USD' } }),
}));

const registry = defaultRegistry();
const CHAIN = 'bitcoin-mainnet';

afterEach(cleanup);

function SpeedAndFees({ onPick }) {
    const tiers = useMemo(() => estimateNativeSendFeeTiers({ chainId: CHAIN, chainRegistry: registry }), []);
    const [value, setValue] = useState({ mode: 'normal' });
    const customEstimate = value.mode === 'custom'
        ? customFeeEstimate({ chainId: CHAIN, chainRegistry: registry, rate: value.customRate })
        : null;
    return (
        <FeeSection
            defaultOpen
            chainId={CHAIN}
            coinTicker="BTC"
            tiers={tiers}
            value={value}
            onChange={(next) => { onPick?.(next); setValue(next); }}
            customEstimate={customEstimate}
            fees={{ quote: { known: true, free: false, amount: '10' }, pending: false }}
        />
    );
}

const section = () => document.querySelector('[data-form-section="fee"]');
const textInputs = () => Array.from(section().querySelectorAll('input:not([type="range"])'));
const networkLine = () => section().querySelector('[data-fees-row="network"]');

describe('Speed and Fees custom fee editor (G113)', () => {
    it('puts the Network fee line in edit mode on Custom and shows no second fee input', () => {
        render(<SpeedAndFees />);
        expect(textInputs()).toHaveLength(0);

        fireEvent.change(screen.getByRole('slider', { name: 'Network fee' }), { target: { value: '3' } });

        // Exactly one fee input in the whole section, and it sits on the
        // Network fee line, showing the live fee for the seeded rate.
        const inputs = textInputs();
        expect(inputs).toHaveLength(1);
        const editor = screen.getByRole('textbox', { name: 'Network fee amount (BTC)' });
        expect(inputs[0]).toBe(editor);
        expect(networkLine()).toContainElement(editor);
        expect(editor).toHaveFocus();
        const normalRate = estimateNativeSendFeeTiers({ chainId: CHAIN, chainRegistry: registry }).normal.rateValue;
        expect(editor).toHaveValue(feeForRate(normalRate, CHAIN));
        expect(screen.queryByRole('textbox', { name: /Custom fee rate/ })).toBeNull();
        expect(section().textContent).not.toMatch(/sat\/vB/);
    });

    it('edits the custom fee only through that line and returns to its Edit control', () => {
        const onPick = vi.fn();
        render(<SpeedAndFees onPick={onPick} />);
        fireEvent.change(screen.getByRole('slider', { name: 'Network fee' }), { target: { value: '3' } });

        const editor = screen.getByRole('textbox', { name: 'Network fee amount (BTC)' });
        fireEvent.change(editor, { target: { value: feeForRate(25, CHAIN) } });
        expect(onPick).toHaveBeenLastCalledWith({ mode: 'custom', customRate: 25 });
        expect(screen.getByRole('slider', { name: 'Network fee' })).toHaveAttribute('aria-valuetext', 'Custom: 25 sat/vB');

        fireEvent.blur(editor);
        expect(textInputs()).toHaveLength(0);
        const edit = screen.getByRole('button', { name: 'Edit exact fee amount' });
        expect(networkLine()).toContainElement(edit);
        expect(networkLine()).toHaveTextContent(feeForRate(25, CHAIN));

        fireEvent.click(edit);
        expect(textInputs()).toHaveLength(1);
        expect(networkLine()).toContainElement(screen.getByRole('textbox', { name: 'Network fee amount (BTC)' }));
    });

    it('closes the editor when the slider leaves Custom', () => {
        render(<SpeedAndFees />);
        const slider = screen.getByRole('slider', { name: 'Network fee' });
        fireEvent.change(slider, { target: { value: '3' } });
        expect(textInputs()).toHaveLength(1);

        fireEvent.change(slider, { target: { value: '2' } });
        expect(textInputs()).toHaveLength(0);
        expect(slider.getAttribute('aria-valuetext')).toMatch(/^Fast:/);
    });
});
