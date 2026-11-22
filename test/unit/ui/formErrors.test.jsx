// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The form error standard (Notice Standard, 2026-11-15): pressing Next lists
// every problem in one danger notice at the top of the form and outlines each
// failing field in red; changing a field clears that field and its line at
// once, the others stay, and the next press validates again.

import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { FormPage } from '../../../packages/core/src/ui/FormPage.jsx';
import { Input } from '../../../packages/core/src/ui/Input.jsx';
import { Textarea } from '../../../packages/core/src/ui/Textarea.jsx';
import { IconSelect } from '../../../packages/core/src/ui/IconSelect.jsx';
import { NetworkField } from '../../../packages/core/src/ui/NetworkField.jsx';
import { TokenField } from '../../../packages/core/src/shared/components/TokenField.jsx';
import { FileField } from '../../../packages/core/src/shared/components/FileField.jsx';
import { useFormErrors } from '../../../packages/core/src/ui/formErrors.js';
import { FormAction, FormFrame, FormSection } from '../../../packages/core/src/shared/components/formStandard/index.js';
import inputStyles from '../../../packages/core/src/ui/Input.module.css';

afterEach(cleanup);

function StandardForm() {
    const form = useFormErrors();
    const [memo, setMemo] = useState('');
    const [speed, setSpeed] = useState('');
    return (
        <FormFrame
            label="Standard"
            errors={form}
            onSubmit={(event) => {
                event.preventDefault();
                form.validate({
                    'std-memo': memo ? null : 'Enter a memo.',
                    'std-speed': speed ? null : 'Pick a speed.',
                });
            }}
            action={<FormAction icon={null}>Next</FormAction>}
        >
            <FormSection id="details" title="Details" summary="">
                <Input id="std-memo" label="Memo" value={memo} onChange={(e) => setMemo(e.target.value)} />
                <IconSelect
                    id="std-speed"
                    label="Speed"
                    value={speed}
                    onChange={setSpeed}
                    options={[{ value: 'fast', label: 'Fast' }, { value: 'slow', label: 'Slow' }]}
                />
            </FormSection>
        </FormFrame>
    );
}

function SignUp() {
    const form = useFormErrors();
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [note, setNote] = useState('');
    const onSubmit = (event) => {
        event.preventDefault();
        form.validate({
            'f-name': name ? null : 'Enter a name.',
            'f-password': password.length >= 8 ? null : 'Password must be at least 8 characters.',
            'f-note': note ? null : 'Add a note.',
        });
    };
    return (
        <FormPage label="Sign up" onSubmit={onSubmit} errors={form} actions={<button type="submit">Next</button>}>
            <Input id="f-name" label="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <Input id="f-password" label="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <Textarea id="f-note" label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
        </FormPage>
    );
}

const summary = () => screen.queryByRole('alert', { name: 'Form errors' });
// Several problems are list items; a single one is a plain line (U101).
const lines = () => [...summary().querySelectorAll('li, [data-notice-issue]')].map((item) => item.textContent);

describe('useFormErrors', () => {
    it('keeps every truthy entry in order and reports whether the form may go on', () => {
        const { result } = renderHook(() => useFormErrors());
        let ok;
        act(() => { ok = result.current.validate({ a: 'A is wrong.', b: null, c: '', d: 'D is wrong.' }); });
        expect(ok).toBe(false);
        expect(result.current.errors).toEqual({ a: 'A is wrong.', d: 'D is wrong.' });
        expect(Object.keys(result.current.errors)).toEqual(['a', 'd']);
        expect(result.current.attempt).toBe(1);

        act(() => result.current.clear('a'));
        expect(result.current.errors).toEqual({ d: 'D is wrong.' });

        act(() => { ok = result.current.validate({ a: null, d: null }); });
        expect(ok).toBe(true);
        expect(result.current.hasErrors).toBe(false);
        expect(result.current.attempt).toBe(2);
    });

    it('adds a form-level problem with fail and drops it on the next validate', () => {
        const { result } = renderHook(() => useFormErrors());
        act(() => result.current.fail('Failed to generate a recovery phrase. Try again.'));
        expect(result.current.errors).toEqual({ form: 'Failed to generate a recovery phrase. Try again.' });
        act(() => { result.current.validate({}); });
        expect(result.current.hasErrors).toBe(false);
    });
});

describe('the form error standard on FormPage', () => {
    it('shows nothing before the first press', () => {
        render(<SignUp />);
        expect(summary()).toBeNull();
        expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-invalid');
    });

    it('lists every problem at the top and outlines each failing field on Next', () => {
        render(<SignUp />);
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));

        const notice = summary();
        expect(notice).toHaveAttribute('data-tone', 'danger');
        expect(notice).toHaveTextContent('Fix 3 things to continue');
        expect(lines()).toEqual(['Enter a name.', 'Password must be at least 8 characters.', 'Add a note.']);
        // The notice leads the form, its first item above the fields (inside the
        // one form card from 600px, operator 2026-11-16).
        const form = screen.getByRole('form', { name: 'Sign up' });
        expect(form.firstElementChild).toContainElement(notice);
        expect(notice.compareDocumentPosition(screen.getByLabelText('Name')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

        for (const label of ['Name', 'Password', 'Note']) {
            const field = screen.getByLabelText(label);
            expect(field, label).toHaveAttribute('aria-invalid', 'true');
        }
        // A red border only: the field's invalid class, never a filled box.
        expect(screen.getByLabelText('Name')).toHaveClass(inputStyles.invalid);
        // Each field also says its own problem under it.
        expect(screen.getAllByText('Enter a name.')).toHaveLength(2);
    });

    it('clears only the changed field and its line, and keeps the cursor in that field', () => {
        render(<SignUp />);
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        const password = screen.getByLabelText('Password');
        password.focus();

        fireEvent.change(password, { target: { value: 'x' } });

        expect(password).not.toHaveAttribute('aria-invalid');
        expect(password).not.toHaveClass(inputStyles.invalid);
        expect(lines()).toEqual(['Enter a name.', 'Add a note.']);
        expect(summary()).toHaveTextContent('Fix 2 things to continue');
        expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByLabelText('Note')).toHaveAttribute('aria-invalid', 'true');
        // A line leaving never pulls the cursor out of the field being fixed.
        expect(document.activeElement).toBe(password);

        fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'hello' } });
        expect(lines()).toEqual(['Enter a name.']);
        expect(summary()).toHaveTextContent('Fix 1 thing to continue');
    });

    it('validates again on the next press and re-marks a field that is still wrong', () => {
        render(<SignUp />);
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } });
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Savings' } });
        expect(screen.getByLabelText('Password')).not.toHaveAttribute('aria-invalid');

        fireEvent.click(screen.getByRole('button', { name: 'Next' }));

        expect(lines()).toEqual(['Password must be at least 8 characters.', 'Add a note.']);
        expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-invalid');
        expect(document.activeElement).toBe(summary());
    });

    it('removes the notice once every problem is fixed', () => {
        render(<SignUp />);
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Savings' } });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'long enough' } });
        fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'hello' } });
        expect(summary()).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        expect(summary()).toBeNull();
    });

    it('puts the notice at the top of a Form Standard form, above its sections, and marks fields inside a section', () => {
        render(<StandardForm />);
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));

        const notice = summary();
        expect(lines()).toEqual(['Enter a memo.', 'Pick a speed.']);
        const sections = document.querySelector('[data-form-sections]');
        expect(notice.compareDocumentPosition(sections) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        // Never in the status slot above the action: it leads the form, its first item.
        expect(notice.closest('[data-form-status-slot]')).toBeNull();
        expect(notice.closest('form').firstElementChild).toContainElement(notice);

        const memo = screen.getByLabelText('Memo');
        const speed = document.getElementById('std-speed');
        expect(memo).toHaveAttribute('aria-invalid', 'true');
        expect(speed).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByText('Pick a speed.', { selector: `.${inputStyles.error}` })).toBeInTheDocument();

        fireEvent.change(memo, { target: { value: 'hello' } });
        expect(memo).not.toHaveAttribute('aria-invalid');
        expect(lines()).toEqual(['Pick a speed.']);

        fireEvent.click(speed);
        fireEvent.click(screen.getByRole('option', { name: /Fast/ }));
        expect(document.getElementById('std-speed')).not.toHaveAttribute('aria-invalid');
        expect(summary()).toBeNull();
    });

    it('lets an error the caller passes win over the map', () => {
        function Override() {
            const form = useFormErrors();
            return (
                <FormPage label="Pay" errors={form} onSubmit={(e) => { e.preventDefault(); form.validate({ amount: 'From the map.' }); }} actions={<button type="submit">Next</button>}>
                    <Input id="amount" label="Amount" error="From the caller." />
                </FormPage>
            );
        }
        render(<Override />);
        expect(screen.getByText('From the caller.')).toBeInTheDocument();
    });
});

// The picker fields read their own entry the same way: NetworkField (and
// ChainPicker through it) by id, TokenField by id, a form-level key through
// formErrorKey, and each drops its entry when a pick changes its value.
describe('the form error standard on the picker fields', () => {
    const registry = {
        get: (id) => ({ bitcoin: { id: 'bitcoin', displayName: 'Bitcoin' }, litecoin: { id: 'litecoin', displayName: 'Litecoin' } }[id]),
    };

    function Pickers({ onError }) {
        const form = useFormErrors();
        const [network, setNetwork] = useState('');
        const [token, setToken] = useState(null);
        const [dest, setDest] = useState('bitcoin');
        return (
            <FormPage
                label="Pickers"
                errors={form}
                errorAction={form.errorFor('pk-token') ? { label: 'Use max', onAction: onError } : undefined}
                onSubmit={(event) => {
                    event.preventDefault();
                    form.validate({
                        'pk-network': network ? null : 'Pick a network.',
                        'pk-token': token ? null : 'Pick a token.',
                        'form:dest': dest === 'litecoin' ? null : 'Pick another destination.',
                    });
                }}
                actions={<button type="submit">Next</button>}
            >
                <NetworkField id="pk-network" label="Network" value={network} onChange={setNetwork} chainIds={['bitcoin', 'litecoin']} chainRegistry={registry} />
                <TokenField id="pk-token" label="Token" value={token} onOpenPicker={() => setToken({ chainId: 'bitcoin', tick: 'XCHAIN' })} />
                <NetworkField label="Move to" formErrorKey="form:dest" value={dest} onChange={setDest} chainIds={['bitcoin', 'litecoin']} chainRegistry={registry} notSource />
            </FormPage>
        );
    }

    it('outlines each picker red with its line under it and clears it on a pick', () => {
        let used = 0;
        render(<Pickers onError={() => { used += 1; }} />);
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));

        expect(lines()).toEqual(['Pick a network.', 'Pick a token.', 'Pick another destination.']);
        const network = document.getElementById('pk-network');
        const token = document.getElementById('pk-token');
        expect(network).toHaveAttribute('aria-invalid', 'true');
        expect(token).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByText('Pick a network.', { selector: `.${inputStyles.error}` })).toBeInTheDocument();
        expect(screen.getByText('Pick a token.', { selector: `.${inputStyles.error}` })).toBeInTheDocument();
        // A form-level key marks its field too, and still lists as a plain line.
        const dest = screen.getByRole('button', { name: /^Move to/ });
        expect(dest).toHaveAttribute('aria-invalid', 'true');

        // The notice carries the form's one action.
        fireEvent.click(within(summary()).getByRole('button', { name: 'Use max' }));
        expect(used).toBe(1);

        // A pick in the field's own picker screen clears its entry.
        fireEvent.click(network);
        fireEvent.click(networkOption(/Bitcoin/));
        expect(document.getElementById('pk-network')).not.toHaveAttribute('aria-invalid');
        expect(lines()).toEqual(['Pick a token.', 'Pick another destination.']);

        // A value the host writes back (the token picker page) clears it too,
        // and the action leaves with its entry.
        fireEvent.click(token);
        expect(document.getElementById('pk-token')).not.toHaveAttribute('aria-invalid');
        expect(within(summary()).queryByRole('button', { name: 'Use max' })).toBeNull();

        fireEvent.click(dest);
        fireEvent.click(networkOption(/Litecoin/));
        expect(summary()).toBeNull();
    });
});

// FileField reads its entry by id like TokenField: the field outlines red
// with its line under it, and picking a file (a new name, not a typed change)
// drops the entry and its line in the notice.
describe('the form error standard on FileField', () => {
    function FilePick() {
        const form = useFormErrors();
        const [name, setName] = useState('');
        return (
            <FormPage
                label="File pick"
                errors={form}
                onSubmit={(event) => {
                    event.preventDefault();
                    form.validate({ 'pk-file': name ? null : 'Choose a file.' });
                }}
                actions={<button type="submit">Next</button>}
            >
                <FileField id="pk-file" label="File" inputLabel="Choose the file" fileName={name} onFile={(file) => setName(file.name)} />
            </FormPage>
        );
    }

    it('outlines the file field red with its line under it and clears it when a file is picked', () => {
        render(<FilePick />);
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));

        expect(lines()).toEqual(['Choose a file.']);
        const field = document.getElementById('pk-file');
        expect(field).toHaveAttribute('aria-invalid', 'true');
        expect(field.className).toContain(inputStyles.invalid);
        expect(screen.getByText('Choose a file.', { selector: `.${inputStyles.error}` })).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Choose the file'), {
            target: { files: [new File(['ok'], 'art.txt', { type: 'text/plain' })] },
        });
        expect(document.getElementById('pk-file')).not.toHaveAttribute('aria-invalid');
        expect(screen.queryByText('Choose a file.', { selector: `.${inputStyles.error}` })).toBeNull();
        expect(summary()).toBeNull();
    });
});

// A row of the open network picker screen, found by the network it names.
function networkOption(name) {
    return [...document.querySelectorAll('[data-network-option]')]
        .find((row) => name.test(row.getAttribute('aria-label') || ''));
}
