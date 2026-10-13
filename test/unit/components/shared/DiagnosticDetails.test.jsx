// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// DiagnosticDetails render contract.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { DiagnosticDetails } from '../../../../packages/core/src/shared/components/DiagnosticDetails.jsx';
import { LogConsole } from '../../../../packages/core/src/shared/components/LogConsole.jsx';
import {
    DIAGNOSTIC_TEXT_LIMIT,
    redactDiagnosticText,
} from '../../../../packages/core/src/shared/utils/diagnosticText.js';

const mocks = vi.hoisted(() => ({
    entries: [],
    copyText: vi.fn(async () => ({ ok: true })),
    clear: vi.fn(),
}));

vi.mock('../../../../packages/core/src/shared/clipboard.js', () => ({
    copyText: mocks.copyText,
}));

vi.mock('../../../../packages/core/src/shared/utils/logConsole.js', () => ({
    logConsole: {
        attach: vi.fn(),
        isAttached: vi.fn(() => true),
        entries: vi.fn(() => mocks.entries),
        subscribe: vi.fn(() => vi.fn()),
        clear: mocks.clear,
    },
}));

beforeEach(() => {
    mocks.entries = [];
    mocks.copyText.mockClear();
    mocks.clear.mockClear();
});

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

describe('diagnostic text safety', () => {
    it('redacts addresses, balances, keys, phrases, and passwords', () => {
        const privateKey = 'a'.repeat(64);
        const recoveryPhrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
        const text = [
            'address=bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080',
            'LM2WMpR1Rp6j3Sa59cMXMs1SPzj9eXpGc1',
            'balance: 12.5 BTC',
            `privateKey=${privateKey}`,
            'seed phrase: abandon ability able about above absent absorb abstract absurd abuse access accident',
            'password="hunter2"',
            recoveryPhrase,
        ].join('\n');

        const result = redactDiagnosticText(text);
        expect(result).not.toContain('bc1qw508');
        expect(result).not.toContain('LM2WMp');
        expect(result).not.toContain('12.5');
        expect(result).not.toContain(privateKey);
        expect(result).not.toContain('abandon ability');
        expect(result).not.toContain('hunter2');
        expect(result).not.toContain(recoveryPhrase);
        expect(result.match(/\[REDACTED\]/g)).toHaveLength(7);
    });

    it('caps every diagnostic string before rendering it', () => {
        const value = 'x'.repeat(DIAGNOSTIC_TEXT_LIMIT + 1000);
        expect(redactDiagnosticText(value).length).toBeLessThan(DIAGNOSTIC_TEXT_LIMIT + 20);
        expect(redactDiagnosticText(value)).toMatch(/\[truncated\]$/);
    });

    it('redacts every field and caps the rendered finding count', () => {
        const items = Array.from({ length: 205 }, (_, index) => ({
            subject: index === 0 ? 'address=0x1234567890abcdef1234567890abcdef12345678' : `subject-${index}`,
            message: index === 0 ? 'balance=99.5' : `message-${index}`,
            location: index === 0 ? 'password=secret' : `file-${index}`,
        }));
        const { container } = render(<DiagnosticDetails summary="findings password=summary-secret" items={items} />);

        expect(container.querySelectorAll('li')).toHaveLength(200);
        expect(container.textContent).not.toContain('1234567890abcdef');
        expect(container.textContent).not.toContain('99.5');
        expect(container.textContent).not.toContain('secret');
        expect(container.textContent).not.toContain('summary-secret');
        expect(screen.getByText('Showing the first 200 of 205 findings.')).toBeTruthy();
    });
});

describe('LogConsole safety and controls', () => {
    it('renders only the newest 200 redacted entries', () => {
        mocks.entries = Array.from({ length: 205 }, (_, index) => ({
            id: index,
            timestamp: index,
            level: 'log',
            source: `source-${index}`,
            message: index === 204 ? 'password=visible-secret' : `message-${index}`,
        }));
        render(<LogConsole />);

        expect(screen.getByRole('log').children).toHaveLength(200);
        expect(screen.queryByText('message-0')).toBeNull();
        expect(screen.queryByText(/visible-secret/)).toBeNull();
        expect(screen.getByText('Showing 200 of 205 matching entries (205 total).')).toBeTruthy();
    });

    it('copies all redacted entries regardless of the active search and clears the buffer', async () => {
        mocks.entries = [
            { id: 1, timestamp: 1, level: 'log', source: 'one', message: 'searchable' },
            { id: 2, timestamp: 2, level: 'error', source: 'two', message: 'password=hunter2' },
        ];
        render(<LogConsole />);
        fireEvent.change(screen.getByLabelText('Search log messages'), { target: { value: 'searchable' } });
        fireEvent.click(screen.getByRole('button', { name: 'Copy all log entries' }));

        await waitFor(() => expect(mocks.copyText).toHaveBeenCalledOnce());
        const copied = mocks.copyText.mock.calls[0][0];
        expect(copied).toContain('one: searchable');
        expect(copied).toContain('two: password=[REDACTED]');
        expect(copied).not.toContain('hunter2');

        fireEvent.click(screen.getByRole('button', { name: 'Clear log buffer' }));
        expect(mocks.clear).toHaveBeenCalledOnce();
        expect(screen.getByText(/No log entries yet/)).toBeTruthy();
    });
});
