// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Input } from '../../../packages/core/src/ui/Input.jsx';
import { Select } from '../../../packages/core/src/ui/Select.jsx';
import { Textarea } from '../../../packages/core/src/ui/Textarea.jsx';
import { FeeSelector } from '../../../packages/core/src/ui/FeeSelector.jsx';
import { PriceAlertForm } from '../../../packages/core/src/shared/components/PriceAlertForm.jsx';
import { TickItemsEditor } from '../../../packages/core/src/shared/components/TickItemsEditor.jsx';
import { TokenField } from '../../../packages/core/src/shared/components/TokenField.jsx';

const TIERS = {
    unit: 'sat/vB',
    minimumRate: 1,
    low: { rateValue: 1, coinAmount: '0.00000100', etaMinutes: 30 },
    normal: { rateValue: 2, coinAmount: '0.00000200', etaMinutes: 10 },
    fast: { rateValue: 3, coinAmount: '0.00000300', etaMinutes: 2 },
};

function expectLinkedError(control, errorText) {
    expect(control).toHaveAttribute('aria-invalid', 'true');
    const ids = (control.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    expect(ids.length, `${control.getAttribute('aria-label') || control.id} error references`).toBeGreaterThan(0);
    const descriptions = ids.map((id) => {
        const description = document.getElementById(id);
        expect(description, `description #${id}`).toBeTruthy();
        return description.textContent;
    });
    expect(descriptions.join(' ')).toContain(errorText);
}

afterEach(cleanup);

describe('form field error references', () => {
    it('resolves each reusable field error to text in the rendered document', () => {
        render(
            <>
                <Input label="Input field" error="Input error" />
                <Select label="Select field" error="Select error">
                    <option value="">Choose</option>
                </Select>
                <Textarea label="Textarea field" error="Textarea error" />
                <TokenField
                    label="Token field"
                    value={null}
                    onOpenPicker={() => {}}
                    error="Token error"
                />
                <TickItemsEditor
                    value="bad token"
                    onChange={() => {}}
                    items={{ valid: [], invalid: ['bad token'], duplicates: 0 }}
                    chainId={null}
                    chainLabel="Bitcoin"
                    listCoin="BTC"
                    messaging={null}
                    onOpenPicker={() => {}}
                    status={{}}
                    onStatusChange={() => {}}
                />
                <PriceAlertForm
                    lockedChainId="bitcoin-mainnet"
                    initialAlert={{
                        chainId: 'bitcoin-mainnet',
                        direction: 'above',
                        targetFiat: 0,
                    }}
                    onCreate={vi.fn()}
                />
                <FeeSelector
                    tiers={TIERS}
                    value={{ mode: 'custom', customRate: 2 }}
                    onChange={() => {}}
                />
            </>,
        );

        const fee = screen.getByLabelText('Custom fee rate (sat/vB)');
        fireEvent.change(fee, { target: { value: '' } });
        fireEvent.blur(fee);

        expectLinkedError(screen.getByLabelText('Input field'), 'Input error');
        expectLinkedError(screen.getByLabelText('Select field'), 'Select error');
        expectLinkedError(screen.getByLabelText('Textarea field'), 'Textarea error');
        expectLinkedError(screen.getByRole('button', { name: /Token field/ }), 'Token error');
        expectLinkedError(screen.getByLabelText('Tokens (one per line)'), 'Not a token name: bad token');
        expectLinkedError(screen.getByLabelText('Target price'), 'Enter a price greater than zero.');
        expectLinkedError(fee, 'Enter a custom fee rate.');
    });

    it('keeps error descriptions scoped when multiple compact forms render together', () => {
        render(
            <>
                <PriceAlertForm
                    lockedChainId="bitcoin-mainnet"
                    initialAlert={{ chainId: 'bitcoin-mainnet', direction: 'above', targetFiat: 0 }}
                    onCreate={vi.fn()}
                />
                <PriceAlertForm
                    lockedChainId="litecoin-mainnet"
                    initialAlert={{ chainId: 'litecoin-mainnet', direction: 'below', targetFiat: -1 }}
                    onCreate={vi.fn()}
                />
            </>,
        );

        const fields = screen.getAllByLabelText('Target price');
        const ids = fields.map((field) => field.getAttribute('aria-describedby'));
        expect(new Set(ids).size).toBe(fields.length);
        fields.forEach((field) => expectLinkedError(field, 'Enter a price greater than zero.'));
    });
});
