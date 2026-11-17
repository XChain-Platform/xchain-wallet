// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Two Form Standard rulings (2026-11-13): a From address fixed by the action
// still shows its picker icon, locked with a reason; and a Memo section that
// holds only the memo draws no field label or ? tip, with its character count
// in the section header.

import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { FromSection, MemoSection } from '../../../packages/core/src/shared/components/formStandard/index.js';
import { FieldIconButton } from '../../../packages/core/src/ui/FieldIconButton.jsx';

const registry = defaultRegistry();
const CHAIN = 'bitcoin-mainnet';
const ADDRESS = 'bc1qexampleexampleexampleexample7c1c';

describe('locked From address', () => {
    it('shows a focusable, aria-disabled picker icon with the reason as its title', () => {
        render(
            <FromSection
                defaultOpen
                chainId={CHAIN}
                chainRegistry={registry}
                address={ADDRESS}
                pickerLabel="Choose source address"
                pickerLockedReason="The delegation's own address signs this clear"
            />,
        );
        const field = screen.getByLabelText('From address');
        expect(field).toHaveAttribute('readonly');
        const picker = screen.getByRole('button', { name: 'Choose source address' });
        expect(picker).toHaveAttribute('aria-disabled', 'true');
        expect(picker).not.toBeDisabled();
        expect(picker).toHaveAttribute('title', "The delegation's own address signs this clear");
        picker.focus();
        expect(document.activeElement).toBe(picker);
    });

    it('keeps an open picker clickable and unlocked', () => {
        const onOpenPicker = vi.fn();
        render(
            <FromSection defaultOpen chainId={CHAIN} chainRegistry={registry} address={ADDRESS} onOpenPicker={onOpenPicker} pickerLabel="Choose source address" />,
        );
        const picker = screen.getByRole('button', { name: 'Choose source address' });
        expect(picker).not.toHaveAttribute('aria-disabled');
        expect(picker).toHaveAttribute('title', 'Choose source address');
        fireEvent.click(picker);
        expect(onOpenPicker).toHaveBeenCalledOnce();
    });

    it('never fires a locked icon button', () => {
        const onClick = vi.fn();
        render(<FieldIconButton icon={<svg />} label="Choose address" onClick={onClick} lockedReason="Fixed by the order" />);
        fireEvent.click(screen.getByRole('button', { name: 'Choose address' }));
        expect(onClick).not.toHaveBeenCalled();
    });
});

function Memo(props) {
    const [memo, setMemo] = useState('');
    return <MemoSection defaultOpen value={memo} onChange={(e) => setMemo(e.target.value)} {...props} />;
}

describe('MemoSection', () => {
    it('names the input Memo with no label row, help tip or second Memo', () => {
        const { container } = render(<Memo />);
        const input = screen.getByRole('textbox', { name: 'Memo' });
        expect(container.querySelector('label')).toBeNull();
        expect(screen.queryByRole('button', { name: 'About Memo' })).toBeNull();
        expect(screen.getAllByText('Memo')).toHaveLength(1);
        expect(input).toHaveAttribute('maxLength', '250');
    });

    it('puts the count in the header after Optional and updates it while typing', () => {
        const { container } = render(<Memo />);
        const header = container.querySelector('[data-form-section-toggle]');
        const count = header.querySelector('[data-section-count]');
        expect(count).toHaveTextContent('0 / 250');
        // The header holds the only count: the field draws none of its own.
        expect(screen.getAllByText('0 / 250')).toHaveLength(1);
        const text = header.textContent;
        expect(text.indexOf('Memo')).toBeLessThan(text.indexOf('Optional'));
        expect(text.indexOf('Optional')).toBeLessThan(text.indexOf('0 / 250'));
        // The count is the last thing before the chevron.
        expect(count.nextElementSibling).toHaveAttribute('data-form-section-chevron');
        const input = screen.getByRole('textbox', { name: 'Memo' });
        fireEvent.change(input, { target: { value: 'hello' } });
        expect(count).toHaveTextContent('5 / 250');
        expect(input.getAttribute('aria-describedby')).toContain(count.firstElementChild.id);
    });

    it('shows the summary while closed and keeps the count mounted for the field description', () => {
        const { container } = render(<MemoSection value="" onChange={() => {}} />);
        const header = container.querySelector('[data-form-section-toggle]');
        expect(header).toHaveAttribute('aria-expanded', 'false');
        expect(header.querySelector('[data-section-summary]')).toHaveTextContent('None');
        const count = header.querySelector('[data-section-count]');
        expect(count).toHaveAttribute('hidden');
        // The memo field is a growing textarea now, not a one-line input.
        const input = container.querySelector('textarea');
        expect(document.getElementById(input.getAttribute('aria-describedby'))).not.toBeNull();
    });

    it('passes the input id, error and disabled state through', () => {
        render(<Memo inputId="send-memo" error="Memo is too long." disabled />);
        const input = screen.getByRole('textbox', { name: 'Memo' });
        expect(input).toHaveAttribute('id', 'send-memo');
        expect(input).toBeDisabled();
        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByText('Memo is too long.')).toBeInTheDocument();
    });
});
