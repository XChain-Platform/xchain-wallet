// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Ruling G96: every wallet dropdown is the themed dropdown, never a native
// grey <select>. Select keeps its public API (option children, e.target.value
// onChange, label/help/hint/error) on top of the IconSelect trigger and list.

import { describe, expect, it, vi } from 'vitest';
import { createRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Select, SelectOption } from '../../../packages/core/src/ui/Select.jsx';
import { selectOption, selectOptionValues } from '../../helpers/selectOption.js';

function Fruit({ onChange = () => {}, initial = 'apple', ...props }) {
    const [value, setValue] = useState(initial);
    return (
        <Select
            label="Fruit"
            value={value}
            onChange={(e) => { setValue(e.target.value); onChange(e); }}
            {...props}
        >
            <option value="apple">Apple</option>
            <option value="banana">Banana</option>
            <option value="blueberry" disabled>Blueberry</option>
            <option value="cherry">Cherry</option>
        </Select>
    );
}

describe('<Select> themed dropdown', () => {
    it('renders no native select, only a labelled combobox trigger', () => {
        const { container } = render(<Fruit />);
        expect(container.querySelector('select')).toBeNull();
        const trigger = screen.getByRole('combobox', { name: 'Fruit' });
        expect(trigger.tagName).toBe('BUTTON');
        expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        expect(trigger).toHaveValue('apple');
        expect(trigger).toHaveTextContent('Apple');
        expect(screen.getByLabelText('Fruit')).toBe(trigger);
    });

    it('calls onChange with an event whose target carries value, name and id', () => {
        const onChange = vi.fn();
        render(<Fruit onChange={onChange} name="fruit" id="fruit-field" />);
        const trigger = screen.getByRole('combobox', { name: 'Fruit' });
        fireEvent.click(trigger);
        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        fireEvent.click(screen.getByRole('option', { name: 'Cherry' }));
        expect(onChange).toHaveBeenCalledTimes(1);
        const event = onChange.mock.calls[0][0];
        expect(event.target).toEqual({ value: 'cherry', name: 'fruit', id: 'fruit-field' });
        expect(event.currentTarget.value).toBe('cherry');
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(trigger).toHaveValue('cherry');
        expect(trigger).toHaveTextContent('Cherry');
        expect(trigger).toHaveFocus();
    });

    it('does not fire onChange when the selected option is picked again', () => {
        const onChange = vi.fn();
        render(<Fruit onChange={onChange} />);
        selectOption(screen.getByRole('combobox', { name: 'Fruit' }), 'apple');
        expect(onChange).not.toHaveBeenCalled();
    });

    it('lists disabled options but never picks them', () => {
        const onChange = vi.fn();
        render(<Fruit onChange={onChange} />);
        const trigger = screen.getByRole('combobox', { name: 'Fruit' });
        fireEvent.click(trigger);
        const blueberry = screen.getByRole('option', { name: 'Blueberry' });
        expect(blueberry).toHaveAttribute('aria-disabled', 'true');
        fireEvent.click(blueberry);
        expect(onChange).not.toHaveBeenCalled();
        expect(() => selectOption(trigger, 'blueberry')).toThrow(/disabled/);
    });

    it('selects with the keyboard: arrows skip disabled options, Enter picks, Escape closes', () => {
        const onChange = vi.fn();
        render(<Fruit onChange={onChange} initial="banana" />);
        const trigger = screen.getByRole('combobox', { name: 'Fruit' });
        trigger.focus();
        fireEvent.keyDown(trigger, { key: 'ArrowDown' });
        const listbox = screen.getByRole('listbox', { name: 'Fruit' });
        expect(screen.getByRole('option', { name: 'Banana' })).toHaveFocus();
        fireEvent.keyDown(listbox, { key: 'ArrowDown' });
        expect(screen.getByRole('option', { name: 'Cherry' })).toHaveFocus();
        fireEvent.keyDown(listbox, { key: 'ArrowUp' });
        expect(screen.getByRole('option', { name: 'Banana' })).toHaveFocus();
        fireEvent.keyDown(listbox, { key: 'End' });
        fireEvent.keyDown(listbox, { key: 'Enter' });
        expect(onChange.mock.calls.at(-1)[0].target.value).toBe('cherry');
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(trigger).toHaveFocus();

        fireEvent.keyDown(trigger, { key: 'ArrowUp' });
        expect(screen.getByRole('listbox')).toBeInTheDocument();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('jumps by type-ahead inside the list and picks by type-ahead on the closed trigger', () => {
        // A fresh search starts once the type-ahead buffer times out.
        let now = 1_000_000;
        const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
        const onChange = vi.fn();
        render(<Fruit onChange={onChange} />);
        const trigger = screen.getByRole('combobox', { name: 'Fruit' });
        trigger.focus();
        fireEvent.keyDown(trigger, { key: 'c' });
        expect(onChange.mock.calls.at(-1)[0].target.value).toBe('cherry');
        expect(screen.queryByRole('listbox')).toBeNull();

        now += 5_000;
        fireEvent.keyDown(trigger, { key: 'ArrowDown' });
        const listbox = screen.getByRole('listbox');
        // b matches Banana only: Blueberry is disabled.
        fireEvent.keyDown(listbox, { key: 'b' });
        expect(screen.getByRole('option', { name: 'Banana' })).toHaveFocus();
        now += 100;
        fireEvent.keyDown(listbox, { key: 'a' });
        // "ba" continues the same search, so Banana keeps focus.
        expect(screen.getByRole('option', { name: 'Banana' })).toHaveFocus();
        clock.mockRestore();
    });

    it('renders an icon per option when one is given, and none otherwise', () => {
        const { container, rerender } = render(
            <Select label="Network" value="btc" onChange={() => {}}>
                <SelectOption value="btc" icon={<span data-testid="icon-btc">B</span>}>Bitcoin</SelectOption>
                <Select.Option value="ltc" icon={<span data-testid="icon-ltc">L</span>} sub="Litecoin mainnet">Litecoin</Select.Option>
            </Select>,
        );
        const trigger = screen.getByRole('combobox', { name: 'Network' });
        expect(trigger.querySelector('[data-testid="icon-btc"]')).not.toBeNull();
        fireEvent.click(trigger);
        expect(screen.getByRole('option', { name: /Bitcoin/ }).querySelector('[data-testid="icon-btc"]')).not.toBeNull();
        const ltc = screen.getByRole('option', { name: /Litecoin/ });
        expect(ltc.querySelector('[data-testid="icon-ltc"]')).not.toBeNull();
        expect(ltc).toHaveTextContent('Litecoin mainnet');

        rerender(
            <Select
                label="Network"
                value="ltc"
                onChange={() => {}}
                options={[
                    { value: 'btc', label: 'Bitcoin', icon: <span data-testid="opt-btc">B</span> },
                    { value: 'ltc', label: 'Litecoin', icon: <span data-testid="opt-ltc">L</span> },
                ]}
            />,
        );
        expect(container.querySelector('[data-testid="opt-ltc"]')).not.toBeNull();

        rerender(
            <Select label="Plain" value="a" onChange={() => {}}>
                <option value="a">A</option>
            </Select>,
        );
        // No option has an icon, so no empty icon column is drawn.
        expect(container.querySelector('[class*="_icon_"]')).toBeNull();
    });

    it('keeps label, help, hint, error and requirement wiring on the trigger', () => {
        const { rerender } = render(
            <Select label="Fee" help="How fast" hint="Pick one" required value="a" onChange={() => {}}>
                <option value="a">Fast</option>
            </Select>,
        );
        const trigger = screen.getByRole('combobox', { name: 'Fee' });
        expect(trigger).toHaveAttribute('aria-required', 'true');
        expect(trigger).toHaveAccessibleDescription('Pick one');
        expect(screen.getByRole('button', { name: 'About Fee' })).toBeInTheDocument();
        rerender(
            <Select label="Fee" error="Choose a fee" value="a" onChange={() => {}}>
                <option value="a">Fast</option>
            </Select>,
        );
        expect(trigger).toHaveAttribute('aria-invalid', 'true');
        expect(trigger).toHaveAccessibleDescription('Choose a fee');
        expect(screen.getByRole('alert')).toHaveTextContent('Choose a fee');
    });

    it('names an unlabelled select from aria-label and keeps disabled native-like', () => {
        render(
            <Select aria-label="Sort" value="new" disabled onChange={() => {}}>
                <option value="new">Newest</option>
                <option value="old">Oldest</option>
            </Select>,
        );
        const trigger = screen.getByRole('combobox', { name: 'Sort' });
        expect(trigger).toBeDisabled();
        fireEvent.click(trigger);
        expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('shows the first enabled option for an unmatched value, and handles numbers, optgroups and defaultValue', () => {
        render(
            <>
                <Select aria-label="Delay" value={30} onChange={() => {}}>
                    <option value={0}>Off</option>
                    <option value={30}>30 s</option>
                </Select>
                <Select aria-label="Missing" value="zzz" onChange={() => {}}>
                    <option value="" disabled>Pick</option>
                    <option value="x">X</option>
                </Select>
                <Select aria-label="Grouped" defaultValue="b">
                    <optgroup label="One"><option value="a">A</option></optgroup>
                    <optgroup label="Two"><option value="b">B</option><option value="c">C</option></optgroup>
                </Select>
            </>,
        );
        expect(screen.getByRole('combobox', { name: 'Delay' })).toHaveValue('30');
        expect(screen.getByRole('combobox', { name: 'Missing' })).toHaveValue('x');
        const grouped = screen.getByRole('combobox', { name: 'Grouped' });
        expect(grouped).toHaveValue('b');
        expect(selectOptionValues(grouped)).toEqual(['a', 'b', 'c']);
        selectOption(grouped, { label: 'C' });
        expect(grouped).toHaveValue('c');
    });

    it('forwards the ref to the trigger and posts a named value through FormData', () => {
        const ref = createRef();
        const { container } = render(
            <form>
                <Select ref={ref} label="Fruit" name="fruit" defaultValue="apple">
                    <option value="apple">Apple</option>
                    <option value="banana">Banana</option>
                </Select>
            </form>,
        );
        expect(ref.current).toBe(screen.getByRole('combobox', { name: 'Fruit' }));
        expect(ref.current.value).toBe('apple');
        selectOption(ref.current, 'banana');
        expect(new FormData(container.querySelector('form')).get('fruit')).toBe('banana');
    });

    it('focuses the trigger, without opening it, when the label is clicked', () => {
        render(<Fruit />);
        fireEvent.click(screen.getByText('Fruit'));
        expect(screen.getByRole('combobox', { name: 'Fruit' })).toHaveFocus();
        expect(screen.queryByRole('listbox')).toBeNull();
    });
});
