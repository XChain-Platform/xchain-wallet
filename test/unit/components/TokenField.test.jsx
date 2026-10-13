// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TokenField } from '../../../packages/core/src/shared/components/TokenField.jsx';

const LONG_TICKER = 'ANEXCEPTIONALLYLONGTOKENNAME';

afterEach(cleanup);

describe('<TokenField>', () => {
    it('opens the picker without submitting its form', () => {
        const onOpenPicker = vi.fn();
        const onSubmit = vi.fn((event) => event.preventDefault());
        render(
            <form onSubmit={onSubmit}>
                <TokenField value={null} onOpenPicker={onOpenPicker} />
            </form>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Token: Select a token' }));

        expect(onOpenPicker).toHaveBeenCalledOnce();
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('names the chain environment and preserves a long ticker when the value clears', () => {
        const { rerender } = render(
            <TokenField
                label="Asset"
                value={{ chainId: 'bitcoin-regtest', tick: LONG_TICKER }}
                onOpenPicker={() => {}}
            />,
        );

        expect(screen.getByRole('button', {
            name: `Asset: ${LONG_TICKER} on Bitcoin · regtest`,
        })).toBeInTheDocument();
        expect(screen.getByText(LONG_TICKER)).toHaveAttribute('title', LONG_TICKER);
        expect(screen.getByText('on Bitcoin · regtest')).toHaveAttribute('title', 'Bitcoin · regtest');

        rerender(<TokenField label="Asset" value={null} onOpenPicker={() => {}} />);
        expect(screen.getByRole('button', { name: 'Asset: Select a token' })).toBeInTheDocument();
        expect(screen.queryByText(LONG_TICKER)).toBeNull();
    });

    it('keeps an unlabelled field free of a leading colon', () => {
        render(<TokenField label="" value={null} onOpenPicker={() => {}} />);

        expect(screen.getByRole('button', { name: 'Select a token' })).toBeInTheDocument();
    });

    it('blocks opening while disabled and associates its error message', () => {
        const onOpenPicker = vi.fn();
        render(
            <TokenField
                id="fee-token"
                value={null}
                onOpenPicker={onOpenPicker}
                disabled
                error="Choose a fee token."
            />,
        );

        const button = screen.getByRole('button', { name: 'Token: Select a token' });
        fireEvent.click(button);

        expect(button).toBeDisabled();
        expect(button).toHaveAttribute('aria-invalid', 'true');
        expect(button).toHaveAttribute('aria-describedby', 'fee-token-error');
        expect(screen.getByRole('alert')).toHaveAttribute('id', 'fee-token-error');
        expect(screen.getByRole('alert')).toHaveTextContent('Choose a fee token.');
        expect(onOpenPicker).not.toHaveBeenCalled();
    });
});
