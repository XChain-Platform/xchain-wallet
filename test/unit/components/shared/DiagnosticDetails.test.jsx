// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// DiagnosticDetails render contract.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { DiagnosticDetails } from '../../../../packages/core/src/shared/components/DiagnosticDetails.jsx';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const collapse = (el) => el.textContent.replace(/\s+/g, ' ').trim();

describe('DiagnosticDetails empty input', () => {
    it('renders nothing when items is not an array', () => {
        const { container } = render(<DiagnosticDetails summary="s" items="nope" />);
        expect(container.innerHTML).toBe('');
    });

    it('renders nothing when items is undefined', () => {
        const { container } = render(<DiagnosticDetails summary="s" />);
        expect(container.innerHTML).toBe('');
    });

    it('renders nothing when items is an empty array', () => {
        const { container } = render(<DiagnosticDetails summary="s" items={[]} />);
        expect(container.innerHTML).toBe('');
    });
});

describe('DiagnosticDetails structure', () => {
    it('puts the summary in a details element carrying the className', () => {
        const { container } = render(<DiagnosticDetails summary="2 findings" items={['a']} className="diag" />);
        const details = container.querySelector('details');
        expect(details.className).toBe('diag');
        expect(details.querySelector(':scope > summary').textContent).toBe('2 findings');
    });

    it('renders a plain string item as one list item', () => {
        const { container } = render(<DiagnosticDetails summary="s" items={['plain text']} />);
        const lis = container.querySelectorAll('li');
        expect(lis).toHaveLength(1);
        expect(lis[0].textContent).toBe('plain text');
        expect(lis[0].querySelector('strong')).toBeNull();
        expect(lis[0].querySelector('span')).toBeNull();
    });
});

describe('DiagnosticDetails object items', () => {
    it('renders the subject in strong followed by a colon and the message', () => {
        const { container } = render(<DiagnosticDetails summary="s" items={[{ subject: 'Subj', message: 'boom' }]} />);
        const li = container.querySelector('li');
        expect(li.querySelector('strong').textContent).toBe('Subj');
        expect(li.textContent).toBe('Subj: boom');
    });

    it('renders the location in parentheses in a span after the message', () => {
        const { container } = render(<DiagnosticDetails summary="s" items={[{ message: 'boom', location: 'a.js:3' }]} />);
        const li = container.querySelector('li');
        expect(li.querySelector('span').textContent).toBe('(a.js:3)');
        expect(li.querySelector('strong')).toBeNull();
        expect(li.textContent.indexOf('boom')).toBeLessThan(li.textContent.indexOf('(a.js:3)'));
    });

    it('collapses a full item to "S: msg (loc)"', () => {
        const items = [{ subject: 'S', message: 'msg', location: 'loc' }];
        const { container } = render(<DiagnosticDetails summary="s" items={items} />);
        expect(collapse(container.querySelector('li'))).toBe('S: msg (loc)');
    });
});

describe('DiagnosticDetails keys', () => {
    it('renders two items with the same message without a duplicate-key error', () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { container } = render(<DiagnosticDetails summary="s" items={['same', 'same']} />);
        expect(container.querySelectorAll('li')).toHaveLength(2);
        expect(errorSpy).not.toHaveBeenCalled();
    });
});
