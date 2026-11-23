// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// U101 (operator 2026-11-21): a notice that lists more than one issue shows
// each issue as its own bullet in a bulleted list inside the notice; a single
// issue stays a plain line with no list.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { NoticeList } from '../../../packages/core/src/ui/NoticeList.jsx';
import { Notice } from '../../../packages/core/src/ui/StatusMessage.jsx';
import { FormErrorSummary } from '../../../packages/core/src/ui/FormErrorSummary.jsx';
import { FormNotice } from '../../../packages/core/src/ui/FormNotice.jsx';
import { FormPage } from '../../../packages/core/src/ui/FormPage.jsx';
import { ConfirmStatusNotice, ConfirmWarningSlot } from '../../../packages/core/src/shared/components/ConfirmStandard.jsx';
import { confirmStatus } from '../../../packages/core/src/shared/utils/confirmStandardModel.js';

afterEach(cleanup);

const items = (...texts) => texts.map((text, i) => ({ key: i, content: text }));

describe('NoticeList', () => {
    it('renders several issues as one list with one list item per issue', () => {
        render(<Notice tone="danger" title="Two problems"><NoticeList items={items('First problem', 'Second problem', 'Third problem')} /></Notice>);
        const list = screen.getByRole('list');
        expect(list.tagName).toBe('UL');
        expect(within(list).getAllByRole('listitem').map((li) => li.textContent))
            .toEqual(['First problem', 'Second problem', 'Third problem']);
    });

    it('renders a single issue as a plain line with no list', () => {
        render(<Notice tone="danger" title="One problem"><NoticeList items={items('Only problem')} /></Notice>);
        expect(screen.queryByRole('list')).toBeNull();
        expect(screen.queryByRole('listitem')).toBeNull();
        expect(screen.getByText('Only problem')).toBeInTheDocument();
    });

    it('can keep a single issue in a bulleted list when the notice requires one', () => {
        render(<Notice tone="danger" title="One problem"><NoticeList items={items('Only problem')} forceList /></Notice>);
        expect(within(screen.getByRole('list')).getByRole('listitem')).toHaveTextContent('Only problem');
    });

    it('renders nothing for no issues, and skips empty entries', () => {
        const { container } = render(<NoticeList items={[]} />);
        expect(container.innerHTML).toBe('');
        render(<NoticeList items={items('', 'Real problem')} />);
        expect(screen.queryByRole('list')).toBeNull();
        expect(screen.getByText('Real problem')).toBeInTheDocument();
    });

    it('carries each item its own attributes and the list its name', () => {
        render(<NoticeList label="Problems" items={[
            { key: 'a', content: 'A', attrs: { 'data-testid': 'issue' } },
            { key: 'b', content: 'B', attrs: { 'data-testid': 'issue' } },
        ]} />);
        expect(screen.getByRole('list', { name: 'Problems' })).toBeInTheDocument();
        expect(screen.getAllByTestId('issue').map((el) => el.tagName)).toEqual(['LI', 'LI']);
    });

    it('draws real bullets, from tokens, over the notice body reset', () => {
        const css = readFileSync('packages/core/src/ui/NoticeList.module.css', 'utf8');
        // The notice body strips markers with `.body > ul` (one class, one
        // type); the list's own selector must outrank it.
        expect(css).toMatch(/ul\.list\[data-notice-list\]\s*\{[^}]*list-style:\s*disc/);
        expect(css).toMatch(/padding-inline-start:\s*var\(--xc-space-\d\)/);
        expect(css).not.toMatch(/\d+px/);
    });
});

describe('FormErrorSummary lists its problems (U101)', () => {
    it('shows several field errors as a bulleted list, one item per field', () => {
        render(<FormErrorSummary focusKey={1} errors={[
            { id: 'a', label: 'Amount', message: 'Enter an amount.' },
            { id: 'b', label: 'Address', message: 'Enter an address.' },
        ]} />);
        const summary = screen.getByRole('alert', { name: 'Form errors' });
        const list = within(summary).getByRole('list');
        expect(within(list).getAllByRole('listitem').map((li) => li.getAttribute('data-error-for'))).toEqual(['a', 'b']);
    });

    it('shows several form-level failures as a bulleted list too', () => {
        render(<FormErrorSummary focusKey={1} errors={[
            { message: 'The network is unreachable.' },
            { message: 'The fee estimate failed.' },
        ]} />);
        const summary = screen.getByRole('alert', { name: 'Form errors' });
        expect(within(summary).getAllByRole('listitem')).toHaveLength(2);
    });

    it('shows a single error as a plain line with no list', () => {
        render(<FormErrorSummary focusKey={1} errors={[{ id: 'a', label: 'Amount', message: 'Enter an amount.' }]} />);
        const summary = screen.getByRole('alert', { name: 'Form errors' });
        expect(within(summary).queryByRole('list')).toBeNull();
        expect(summary.querySelector('[data-error-for="a"]')).toHaveTextContent('Enter an amount.');
    });
});

describe('FormNotice lines', () => {
    it('lists separate issues as bullets when the form marks them so', () => {
        render(
            <FormPage actions={<button type="submit">Go</button>}>
                <FormNotice variant="warning" role="alert" lines={['Warning one', 'Warning two']} bullets />
            </FormPage>,
        );
        expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Warning one', 'Warning two']);
    });

    it('keeps the sentences of one message as plain lines', () => {
        render(
            <FormPage actions={<button type="submit">Go</button>}>
                <FormNotice variant="warning" role="alert" lines={['Sentence one.', 'Sentence two.']} />
            </FormPage>,
        );
        expect(screen.queryByRole('listitem')).toBeNull();
        expect(screen.getByText('Sentence one.')).toBeInTheDocument();
    });
});

describe('Confirm notices (U101)', () => {
    const approved = { code: 'DRYRUN_VALID', severity: 'info', source: 'dryrun', overridable: false, message: 'Accepted.', data: {} };

    it('lists each check the network could not verify as a bullet under the partly checked sentence', () => {
        const status = confirmStatus({
            report: {
                verdict: 'pass',
                findings: [approved],
                unverified: [
                    { check: 'LIST_LOOKUP', reason: 'x' },
                    { check: 'DISPENSER_LOOKUP', reason: 'x' },
                    { check: 'DURATION_FEE', reason: 'x' },
                ],
            },
        });
        expect(status.state).toBe('partial');
        render(<ConfirmStatusNotice status={status} />);
        const notice = screen.getByTestId('confirm-status');
        expect(notice).toHaveTextContent('Only partly checked');
        const list = within(notice).getByRole('list');
        expect(within(list).getAllByRole('listitem')).toHaveLength(3);
        // The summary sentence leads as a plain line, outside the list.
        const lead = within(notice).getByText(/The network checked only part of this action/);
        expect(lead.closest('ul')).toBeNull();
        expect(within(notice).getAllByTestId('confirm-warning-point')).toHaveLength(4);
    });

    it('shows a single unverified check as a plain line with no list', () => {
        const status = confirmStatus({
            report: { verdict: 'pass', findings: [approved], unverified: [{ check: 'LIST_LOOKUP', reason: 'x' }] },
        });
        render(<ConfirmStatusNotice status={status} />);
        expect(within(screen.getByTestId('confirm-status')).queryByRole('list')).toBeNull();
    });

    it('lists several short warnings as bullets, and keeps one as a plain line', () => {
        const warning = (texts) => ({
            title: 'Check this',
            points: texts.map((text, i) => ({ key: `w${i}`, text })),
            overrides: [],
            role: null,
            state: 'irreversible',
        });
        const { unmount } = render(<ConfirmWarningSlot warning={warning(['You cannot undo this.', 'The fee is high.'])} />);
        expect(within(screen.getByTestId('confirm-warning')).getAllByRole('listitem')).toHaveLength(2);
        unmount();
        render(<ConfirmWarningSlot warning={warning(['You cannot undo this.'])} />);
        expect(within(screen.getByTestId('confirm-warning')).queryByRole('list')).toBeNull();
    });
});
