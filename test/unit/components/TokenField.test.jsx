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

    it('shows only the ticker text, names the chain for screen readers, and preserves a long ticker', () => {
        const { rerender } = render(
            <TokenField
                label="Asset"
                value={{ chainId: 'bitcoin-regtest', tick: LONG_TICKER }}
                onOpenPicker={() => {}}
            />,
        );

        expect(screen.getByRole('button', {
            name: `Asset: ${LONG_TICKER} on Bitcoin`,
        })).toBeInTheDocument();
        expect(screen.getByText(LONG_TICKER)).toHaveAttribute('title', LONG_TICKER);
        expect(screen.queryByText(/Bitcoin|regtest/)).toBeNull();

        rerender(<TokenField label="Asset" value={null} onOpenPicker={() => {}} />);
        expect(screen.getByRole('button', { name: 'Asset: Select a token' })).toBeInTheDocument();
        expect(screen.queryByText(LONG_TICKER)).toBeNull();
    });

    it('keeps an unlabelled field free of a leading colon', () => {
        render(<TokenField label="" value={null} onOpenPicker={() => {}} />);

        expect(screen.getByRole('button', { name: 'Select a token' })).toBeInTheDocument();
    });

    it('shows the shared optional pill without adding it to the accessible name', () => {
        const { container } = render(
            <TokenField label="Deposit" optional value={null} onOpenPicker={() => {}} />,
        );
        const button = screen.getByRole('button', { name: 'Deposit: Select a token' });
        const pill = container.querySelector('[data-optional-pill]');

        expect(pill).toHaveTextContent('Optional');
        expect(button.getAttribute('aria-describedby')?.split(' ')).toContain(pill.id);
        expect(button).not.toHaveAttribute('aria-required');
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

    it('draws the label help tip beside the label when help is given', () => {
        render(
            <TokenField
                label="Callback token"
                help="The token each holder receives when the callback runs."
                value={null}
                onOpenPicker={() => {}}
            />,
        );
        const tip = screen.getByRole('button', { name: 'About Callback token' });
        expect(tip.parentElement.closest('div').textContent).toContain('Callback token');
        fireEvent.click(tip);
        expect(screen.getByText('The token each holder receives when the callback runs.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Callback token: Select a token' })).toBeInTheDocument();
    });

    it('shows the Optional pill and the help tip together', () => {
        render(<TokenField label="Token" optional help="Pick a token." value={null} onOpenPicker={() => {}} />);
        expect(screen.getByText('Optional')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'About Token' })).toBeInTheDocument();
    });

    it('keeps the plain label and no tip when help is not given', () => {
        render(<TokenField value={null} onOpenPicker={() => {}} />);
        expect(screen.getByText('Token')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^About / })).toBeNull();
    });
});
