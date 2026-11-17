// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The Wallet Form Standard touch-up props (FromSection disabled and
// network label, a locked picker icon without a picker; FormSection main, tag and
// count; FeeSection fixed-fee mode; FormAction type="button" in the success
// style; NetworkField notSource; RadioGroup option icons).

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import {
    FeeSection,
    FormAction,
    FormSection,
    FromSection,
} from '../../../packages/core/src/shared/components/formStandard/index.js';
import { useFormSections } from '../../../packages/core/src/shared/components/formStandard/useFormSections.js';
import { NetworkField } from '../../../packages/core/src/ui/NetworkField.jsx';
import { RadioGroup } from '../../../packages/core/src/ui/RadioGroup.jsx';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings: { fiatCurrency: 'USD' } }),
}));

const registry = defaultRegistry();
const CHAIN = 'bitcoin-mainnet';
const ADDRESS = 'bc1qexampleexampleexampleexample7c1c';

function Icon() {
    return <svg data-testid="option-icon" />;
}

describe('FromSection touch-up props', () => {
    it('renames the Network field and holds both fields while disabled', () => {
        render(
            <FromSection
                defaultOpen
                chainId={CHAIN}
                chainIds={[CHAIN, 'litecoin-mainnet']}
                chainRegistry={registry}
                onNetworkChange={() => {}}
                networkLabel="Publishing network"
                address={ADDRESS}
                onOpenPicker={() => {}}
                pickerLabel="Choose source address"
                disabled
            />,
        );
        expect(screen.getByRole('button', { name: 'Publishing network: Bitcoin' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Choose source address' })).toBeDisabled();
    });

    it('shows the picker icon locked when the host has no picker', () => {
        render(
            <FromSection defaultOpen chainId={CHAIN} chainRegistry={registry} lockNetwork address={ADDRESS} />,
        );
        expect(screen.getByLabelText('From address')).toHaveValue(ADDRESS);
        const picker = screen.getByRole('button', { name: 'Choose address' });
        expect(picker).toHaveAttribute('aria-disabled', 'true');
        expect(picker).toHaveAttribute('title', 'This action signs from this address only');
    });
});

describe('FormSection touch-up props', () => {
    it('marks the main section and puts a tag after Optional', () => {
        const { container } = render(
            <FormSection id="locks" title="Locks" optional main tag={<span>Irreversible</span>} summary="Not set">
                <p>body</p>
            </FormSection>,
        );
        const section = container.querySelector('[data-form-section="locks"]');
        expect(section).toHaveAttribute('data-form-main', '');
        const header = section.querySelector('[data-form-section-toggle]');
        expect(header.textContent.indexOf('Optional')).toBeLessThan(header.textContent.indexOf('Irreversible'));
        expect(section.querySelector('[data-form-section-title]')).toHaveTextContent('Locks');
        expect(section.querySelector('[data-form-section-chevron]')).not.toBeNull();
    });

    it('shows the count only while open, where the summary was', () => {
        const { container } = render(
            <FormSection id="memo" title="Memo" summary="None" count="12 / 250"><p>body</p></FormSection>,
        );
        // Closed, the count stays mounted but hidden (a field may name it in
        // aria-describedby).
        expect(container.querySelector('[data-section-count]')).toHaveAttribute('hidden');
        expect(container.querySelector('[data-section-summary]')).toHaveTextContent('None');
        fireEvent.click(screen.getByRole('button', { name: /^Memo/ }));
        expect(container.querySelector('[data-section-count]')).not.toHaveAttribute('hidden');
        expect(container.querySelector('[data-section-count]')).toHaveTextContent('12 / 250');
        expect(container.querySelector('[data-section-summary]')).toBeNull();
    });

    it('useFormSections marks the section the form opens on load as main', () => {
        function Host() {
            const sections = useFormSections({ from: false, payment: true, memo: false, fee: false });
            return (
                <>
                    <FormSection id="payment" title="Payment" {...sections.bind('payment')}><p>a</p></FormSection>
                    <FormSection id="memo" title="Memo" {...sections.bind('memo')}><p>b</p></FormSection>
                </>
            );
        }
        const { container } = render(<Host />);
        expect(container.querySelector('[data-form-section="payment"]')).toHaveAttribute('data-form-main', '');
        expect(container.querySelector('[data-form-section="memo"]')).not.toHaveAttribute('data-form-main');
    });
});

describe('FeeSection fixed-fee mode', () => {
    it('shows the fee figure with no speed picker', () => {
        const { container } = render(
            <FeeSection defaultOpen chainId={CHAIN} coinTicker="BTC" fixedFee="0.00001410" />,
        );
        expect(screen.queryByRole('slider')).toBeNull();
        expect(container.querySelector('[data-fees-row="network"]')).toHaveTextContent(/^Network fee.*0\.0000141 BTC$/);
        fireEvent.click(screen.getByRole('button', { name: /^Speed and Fees/ }));
        expect(container.querySelector('[data-section-summary]')).toHaveTextContent(/^Normal · 0\.0000141 BTC$/);
    });
});

describe('FormAction', () => {
    it('draws type="button" in the same success style as a submit', () => {
        render(
            <>
                <FormAction icon={<Icon />}>Create Order</FormAction>
                <FormAction type="button" icon={<Icon />}>Open Step</FormAction>
            </>,
        );
        expect(screen.getByRole('button', { name: 'Create Order' })).toHaveClass(buttonStyles.success);
        const button = screen.getByRole('button', { name: 'Open Step' });
        expect(button).toHaveAttribute('type', 'button');
        expect(button).toHaveClass(buttonStyles.success);
    });
});

describe('NetworkField notSource', () => {
    it('marks a data network as exempt from the From rule', () => {
        const { container, rerender } = render(
            <NetworkField value={CHAIN} onChange={() => {}} chainIds={[CHAIN]} chainRegistry={registry} />,
        );
        expect(container.querySelector('[data-form-network-exempt]')).toBeNull();
        rerender(
            <NetworkField value={CHAIN} onChange={() => {}} chainIds={[CHAIN]} chainRegistry={registry} notSource />,
        );
        expect(container.querySelector('[data-form-network-exempt]')).not.toBeNull();
    });
});

describe('RadioGroup option icons', () => {
    it('draws each icon before its label and keeps the accessible name the text', () => {
        render(
            <RadioGroup
                legend="Mode"
                value="a"
                onChange={() => {}}
                options={[
                    { value: 'a', label: 'New stake', icon: Icon },
                    { value: 'b', label: 'Top up', icon: <Icon /> },
                ]}
            />,
        );
        expect(screen.getByRole('radio', { name: 'New stake' })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'Top up' })).toBeInTheDocument();
        expect(screen.getAllByTestId('option-icon')).toHaveLength(2);
    });
});
