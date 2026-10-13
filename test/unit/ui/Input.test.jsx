// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, createEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { useRef, useEffect } from 'react';
import { Input } from '../../../packages/core/src/ui/Input.jsx';
import { IconSelect } from '../../../packages/core/src/ui/IconSelect.jsx';
import { Select } from '../../../packages/core/src/ui/Select.jsx';
import { Textarea } from '../../../packages/core/src/ui/Textarea.jsx';

const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');

afterEach(() => {
    if (originalInnerWidth) Object.defineProperty(window, 'innerWidth', originalInnerWidth);
});

describe('<Input>', () => {
    it.each(['sm', 'md', 'lg'])('shares the %s height and radius tokens across text controls', (size) => {
        render(
            <>
                <Input label="Name" size={size} />
                <Select label="Network" size={size} defaultValue="mainnet">
                    <option value="mainnet">Mainnet</option>
                </Select>
                <IconSelect
                    label="Mode"
                    size={size}
                    value="private"
                    options={[{ value: 'private', label: 'Private' }]}
                    onChange={() => {}}
                />
            </>,
        );

        const input = screen.getByLabelText('Name');
        const select = screen.getByLabelText('Network');
        const iconSelect = screen.getByRole('button', { name: 'Mode: Private' });
        expect(input.parentElement.parentElement.className).toContain(size);
        expect(select.parentElement.parentElement.className).toContain(size);
        expect(iconSelect.parentElement.className).toContain(size);

        const inputCss = readFileSync('packages/core/src/ui/Input.module.css', 'utf8');
        const iconSelectCss = readFileSync('packages/core/src/ui/IconSelect.module.css', 'utf8');
        const tokensCss = readFileSync('packages/core/src/ui/tokens.css', 'utf8');
        const heightRule = new RegExp(
            `\\.${size}\\s*\\{[^}]*--xc-control-height:\\s*var\\(--xc-control-h-${size}\\)`,
            's',
        );
        const heights = { sm: '32px', md: '40px', lg: '48px' };
        expect(inputCss).toMatch(heightRule);
        expect(iconSelectCss).toMatch(heightRule);
        expect(tokensCss).toMatch(new RegExp(`--xc-control-h-${size}:\\s*${heights[size]}`));
        expect(tokensCss).toMatch(/--xc-control-radius:\s*var\(--xc-radius-md\)/);
        expect(inputCss).toMatch(/\.input\s*\{[^}]*border-radius:\s*var\(--xc-control-radius\)/s);
        expect(iconSelectCss).toMatch(/\.trigger\s*\{[^}]*border-radius:\s*var\(--xc-control-radius\)/s);
    });

    it('associates label via htmlFor / id', () => {
        render(<Input label="Email" />);
        const input = screen.getByLabelText('Email');
        expect(input).toBeInTheDocument();
        expect(input.tagName).toBe('INPUT');
    });

    it('associates labels with textarea and select controls', () => {
        render(
            <>
                <Textarea label="Notes" />
                <Select label="Network" defaultValue="mainnet">
                    <option value="mainnet">Mainnet</option>
                </Select>
            </>,
        );
        expect(screen.getByLabelText('Notes').tagName).toBe('TEXTAREA');
        expect(screen.getByLabelText('Network').tagName).toBe('SELECT');
    });

    it('uses one field-requirement convention in labels and accessibility metadata', () => {
        render(
            <>
                <Input label="Account name" />
                <Textarea label="Memo" optional />
                <Select label="Expiration (optional)" defaultValue="none">
                    <option value="none">No expiration</option>
                </Select>
            </>,
        );

        expect(screen.getByLabelText('Account name')).toHaveAttribute('aria-required', 'true');
        expect(screen.getByLabelText('Memo (optional)')).toHaveAttribute('aria-required', 'false');
        expect(screen.getByLabelText('Expiration (optional)')).toHaveAttribute('aria-required', 'false');
        expect(screen.queryByText(/\(required\)/i)).toBeNull();
    });

    it('renders hint and ties it via aria-describedby', () => {
        render(<Input label="Password" hint="Min 8 chars" />);
        const input = screen.getByLabelText('Password');
        const describedBy = input.getAttribute('aria-describedby');
        expect(describedBy).toBeTruthy();
        const hintId = describedBy.split(' ')[0];
        expect(document.getElementById(hintId)).toHaveTextContent('Min 8 chars');
    });

    it.each([360, 412])('uses a concise placeholder at %dpx and preserves the full hint as its description', (width) => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
        render(<Input label="Receive at" placeholder="Automatically filled from your wallet on the get chain" />);

        const input = screen.getByLabelText('Receive at');
        expect(input).toHaveAttribute('placeholder', 'Receive at');
        expect(input).toHaveAccessibleDescription('Automatically filled from your wallet on the get chain');
    });

    it('keeps the full placeholder at tablet and desktop widths', () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 768 });
        render(<Input label="Receive at" placeholder="Automatically filled from your wallet on the get chain" />);

        const input = screen.getByLabelText('Receive at');
        expect(input).toHaveAttribute(
            'placeholder',
            'Automatically filled from your wallet on the get chain',
        );
        expect(input).not.toHaveAttribute('aria-describedby');
    });

    it('renders error and sets aria-invalid, hiding the hint to avoid noise', () => {
        render(
            <Input label="Email" hint="Use work email" error="Required" />,
        );
        const input = screen.getByLabelText('Email');
        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByRole('alert')).toHaveTextContent('Required');
        expect(screen.queryByText('Use work email')).toBeNull();
        const describedIds = input.getAttribute('aria-describedby').split(' ');
        expect(describedIds).toHaveLength(1);
        expect(document.getElementById(describedIds[0])).toHaveTextContent('Required');
    });

    it('keeps caller descriptions alongside generated field descriptions', () => {
        render(
            <>
                <div id="requirements">Must be unique</div>
                <Textarea
                    label="Handle"
                    hint="Publicly visible"
                    aria-describedby="requirements"
                />
            </>,
        );
        const textarea = screen.getByLabelText('Handle');
        const descriptions = textarea.getAttribute('aria-describedby').split(' ');
        expect(descriptions).toContain('requirements');
        expect(descriptions.map((id) => document.getElementById(id)?.textContent))
            .toEqual(['Must be unique', 'Publicly visible']);
    });

    it('omits aria-invalid when there is no error', () => {
        render(<Input label="Name" />);
        expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-invalid');
    });

    it('uses mobile-safe text-entry defaults', () => {
        render(<Input label="Code" />);
        const input = screen.getByLabelText('Code');
        expect(input).toHaveAttribute('type', 'text');
        expect(input).toHaveAttribute('autocapitalize', 'off');
        expect(input).toHaveAttribute('autocorrect', 'off');
        expect(input).toHaveAttribute('spellcheck', 'false');
        expect(input).toHaveAttribute('enterkeyhint', 'done');
    });

    it('uses a search return key and honors keyboard-hint overrides', () => {
        const { rerender } = render(<Input label="Find" type="search" />);
        expect(screen.getByLabelText('Find')).toHaveAttribute('enterkeyhint', 'search');

        rerender(
            <Input
                label="Name"
                autoCapitalize="words"
                autoCorrect="on"
                spellCheck
                enterKeyHint="go"
            />,
        );
        const input = screen.getByLabelText('Name');
        expect(input).toHaveAttribute('autocapitalize', 'words');
        expect(input).toHaveAttribute('autocorrect', 'on');
        expect(input).toHaveAttribute('spellcheck', 'true');
        expect(input).toHaveAttribute('enterkeyhint', 'go');
    });

    it.each([
        ['email', 'email'],
        ['number', 'decimal'],
        ['search', 'search'],
        ['tel', 'tel'],
        ['url', 'url'],
    ])('uses the %s mobile keyboard for a semantic input type', (type, inputMode) => {
        render(<Input label="Value" type={type} />);
        expect(screen.getByLabelText('Value')).toHaveAttribute('inputmode', inputMode);
    });

    it('honors an input mode override', () => {
        render(<Input label="Whole number" type="number" inputMode="numeric" />);
        expect(screen.getByLabelText('Whole number')).toHaveAttribute('inputmode', 'numeric');
    });

    it('pass-through value + onChange work end-to-end', () => {
        const onChange = vi.fn();
        render(<Input label="Amount" value="1" onChange={onChange} />);
        const input = screen.getByLabelText('Amount');
        expect(input).toHaveValue('1');
        fireEvent.change(input, { target: { value: '2' } });
        expect(onChange).toHaveBeenCalledOnce();
    });

    it.each([
        ['input', <Input label="Name" hint="Help" error="Required" defaultValue="" />],
        ['textarea', <Textarea label="Name" hint="Help" error="Required" defaultValue="" />],
        ['select', (
            <Select label="Name" hint="Help" error="Required" defaultValue="">
                <option value="">Choose</option>
                <option value="one">One</option>
            </Select>
        )],
    ])('clears %s invalid state and error on edit', (_name, field) => {
        render(field);
        const control = screen.getByLabelText('Name');
        const invalidClass = control.className;
        expect(control).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByRole('alert')).toHaveTextContent('Required');
        expect(screen.queryByText('Help')).toBeNull();
        expect(control.getAttribute('aria-describedby').split(' ')
            .every((id) => document.getElementById(id))).toBe(true);
        fireEvent.change(control, { target: { value: 'one' } });
        expect(control).not.toHaveAttribute('aria-invalid');
        expect(control.className).not.toBe(invalidClass);
        expect(screen.queryByRole('alert')).toBeNull();
        const hint = screen.getByText('Help');
        expect(control.getAttribute('aria-describedby').split(' ')).toContain(hint.id);
    });

    it('shows the same error again when its key changes', () => {
        const view = render(
            <Input label="Name" error="Required" errorKey={1} defaultValue="" />,
        );
        const input = screen.getByLabelText('Name');
        fireEvent.change(input, { target: { value: 'x' } });
        expect(screen.queryByRole('alert')).toBeNull();

        view.rerender(
            <Input label="Name" error="Required" errorKey={2} defaultValue="" />,
        );
        expect(screen.getByRole('alert')).toHaveTextContent('Required');
        expect(input).toHaveAttribute('aria-invalid', 'true');
    });

    it('renders and updates an input character counter described by the field', () => {
        render(<Input label="Alias" defaultValue="abc" maxLength={10} />);
        const input = screen.getByLabelText('Alias');
        const counter = screen.getByText('3 / 10');
        expect(input.getAttribute('aria-describedby').split(' ')).toContain(counter.id);
        fireEvent.change(input, { target: { value: 'abcd' } });
        expect(screen.getByText('4 / 10')).toBe(counter);
    });

    it('renders a textarea counter from its controlled value', () => {
        const view = render(<Textarea label="Bio" value="hello" maxLength={20} onChange={() => {}} />);
        expect(screen.getByText('5 / 20')).toBeInTheDocument();
        view.rerender(<Textarea label="Bio" value="hello world" maxLength={20} onChange={() => {}} />);
        expect(screen.getByText('11 / 20')).toBeInTheDocument();
    });

    it('shows a Caps Lock warning only while a password field is focused', () => {
        render(<Input label="Password" type="password" />);
        const input = screen.getByLabelText('Password');
        fireEvent.focus(input);
        const keyDown = createEvent.keyDown(input);
        Object.defineProperty(keyDown, 'getModifierState', { value: () => true });
        fireEvent(input, keyDown);
        const warning = screen.getByRole('status');
        expect(warning).toHaveTextContent('Caps Lock is on');
        expect(input.getAttribute('aria-describedby').split(' ')).toContain(warning.id);
        fireEvent.blur(input);
        expect(screen.queryByRole('status')).toBeNull();
    });

    it('forwards ref so callers can focus-manage', () => {
        function Harness() {
            const ref = useRef(null);
            useEffect(() => {
                ref.current?.focus();
            }, []);
            return <Input ref={ref} label="Focus me" />;
        }
        render(<Harness />);
        expect(document.activeElement).toBe(screen.getByLabelText('Focus me'));
    });

    it('date-time fields name the local time zone and show the value in UTC', () => {
        const { rerender } = render(<Input label="Expires" type="datetime-local" value="" onChange={() => {}} />);
        const input = screen.getByLabelText('Expires');
        const ids = input.getAttribute('aria-describedby').split(' ');
        const zone = document.getElementById(ids[ids.length - 1]);
        expect(zone).toHaveTextContent(/^Time is in your local time zone/);
        expect(zone).not.toHaveTextContent('UTC.');
        rerender(<Input label="Expires" type="datetime-local" value="2026-12-01T15:30" onChange={() => {}} />);
        const iso = new Date(Date.parse('2026-12-01T15:30')).toISOString();
        expect(zone).toHaveTextContent(`That is ${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC.`);
    });

    it.each([
        ['date', '2026-10-13', '2026-10-15'],
        ['datetime-local', '2026-10-13T09:30', '2026-10-15T17:00'],
        ['time', '09:30', '17:00'],
    ])('keeps the native %s picker and keyboard entry within passed bounds', (type, min, max) => {
        const onChange = vi.fn();
        render(
            <Input
                label="When"
                type={type}
                min={min}
                max={max}
                defaultValue={min}
                onChange={onChange}
            />,
        );
        const input = screen.getByLabelText('When');
        expect(input).toHaveAttribute('type', type);
        expect(input).toHaveAttribute('min', min);
        expect(input).toHaveAttribute('max', max);
        fireEvent.change(input, { target: { value: max } });
        expect(onChange).toHaveBeenCalledOnce();
        expect(onChange.mock.calls[0][0].target.value).toBe(max);
    });

    it('explains date range violations and clears the error after a valid entry', () => {
        render(
            <Input
                label="From date"
                type="date"
                min="2026-10-10"
                max="2026-10-20"
                defaultValue="2026-10-01"
            />,
        );
        const input = screen.getByLabelText('From date');
        fireEvent.blur(input);
        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Choose a date on or after 2026-10-10.',
        );

        fireEvent.change(input, { target: { value: '2026-10-21' } });
        fireEvent.blur(input);
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Choose a date on or before 2026-10-20.',
        );

        fireEvent.change(input, { target: { value: '2026-10-15' } });
        fireEvent.blur(input);
        expect(input).not.toHaveAttribute('aria-invalid');
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('explains a required date that is left incomplete', () => {
        render(<Input label="Expires" type="datetime-local" required />);
        const input = screen.getByLabelText('Expires');
        fireEvent.invalid(input);
        expect(screen.getByRole('alert')).toHaveTextContent('Choose a date and time.');
        expect(input.getAttribute('aria-describedby').split(' '))
            .toContain(screen.getByRole('alert').id);
    });

    it('other field types get no time zone line', () => {
        render(<Input label="Name" />);
        expect(screen.queryByText(/local time zone/)).toBeNull();
    });

    it('keeps text controls at 16px on touch devices at every width without changing desktops', () => {
        const css = readFileSync(
            'packages/core/src/ui/tokens.css',
            'utf8',
        );
        const touchRule = /@media \(pointer: coarse\), \(hover: none\)\s*\{\s*input:not\(\[type='checkbox'\]\)[\s\S]*?select,[\s\S]*?textarea\s*\{\s*font-size: 1rem !important;/;
        expect(css).toMatch(touchRule);
        expect(css).not.toMatch(/@media \([^)]*(?:max|min)-width[^)]*\)[^{]*\{\s*input:not\(\[type='checkbox'\]\)[\s\S]*?font-size: 1rem !important;/);
    });
});
