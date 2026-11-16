// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MultipartUploadPanel } from '../../../packages/core/src/shared/components/MultipartUploadPanel.jsx';

const progress = {
    totalParts: 4,
    transactions: 11,
    currentPart: 2,
    unfinished: [],
};

const unfinished = [
    { id: 'one', name: 'first.png', partsSent: 1, totalParts: 4, paidTransactions: 1 },
    { id: 'two', name: 'second.zip', partsSent: 3, totalParts: 5, paidTransactions: 7 },
];

describe('MultipartUploadPanel sending stage', () => {
    it('shows the current part and transaction counts', () => {
        render(<MultipartUploadPanel {...progress} stage="sending" />);

        const status = screen.getByRole('status');
        expect(status).toHaveTextContent('Uploading part 2 of 4');
        expect(status).toHaveTextContent('4 parts, 11 transactions');
    });
});

describe('MultipartUploadPanel assembling stage', () => {
    it('shows that all parts are waiting for assembly', () => {
        render(<MultipartUploadPanel {...progress} stage="assembling" />);

        const status = screen.getByRole('status');
        expect(status).toHaveTextContent('Waiting for file assembly');
        expect(status).toHaveTextContent('All 4 parts uploaded');
        expect(status).toHaveTextContent('4 parts, 11 transactions');
    });
});

describe('MultipartUploadPanel unfinished upload actions', () => {
    it('shows upload counts and forwards each id to its callback', () => {
        const onContinue = vi.fn();
        const onDiscard = vi.fn();
        render(<MultipartUploadPanel unfinished={unfinished} onContinue={onContinue} onDiscard={onDiscard} />);

        const first = screen.getByRole('article', { name: 'first.png' });
        const second = screen.getByRole('article', { name: 'second.zip' });
        expect(first).toHaveTextContent('1 of 4 parts uploaded');
        expect(second).toHaveTextContent('3 of 5 parts uploaded');

        fireEvent.click(within(second).getByRole('button', { name: 'Continue' }));
        fireEvent.click(within(first).getByRole('button', { name: /Discard/ }));
        expect(onContinue).toHaveBeenCalledWith('two');
        expect(onDiscard).toHaveBeenCalledWith('one');
    });
});

describe('MultipartUploadPanel paid transaction copy', () => {
    it('uses singular and plural transaction text', () => {
        render(<MultipartUploadPanel unfinished={unfinished} />);

        expect(screen.getByRole('button', {
            name: 'Discard (1 transaction already paid)',
        })).toBeEnabled();
        expect(screen.getByRole('button', {
            name: 'Discard (7 transactions already paid)',
        })).toBeEnabled();
    });
});

describe('MultipartUploadPanel empty unfinished list', () => {
    it('does not render unfinished upload cards', () => {
        const { container } = render(<MultipartUploadPanel unfinished={[]} />);

        expect(screen.queryByRole('region', { name: 'Unfinished uploads' })).toBeNull();
        expect(screen.queryByRole('article')).toBeNull();
        expect(container).toBeEmptyDOMElement();
    });
});
