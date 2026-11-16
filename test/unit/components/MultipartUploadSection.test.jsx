// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import React, { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MultipartUploadSection } from '../../../packages/core/src/shared/components/MultipartUploadSection.jsx';

const progress = {
    totalParts: 4,
    transactions: 11,
    currentPart: 2,
    unfinished: [],
};

const unfinished = [{
    id: 'saved',
    name: 'saved.png',
    partsSent: 1,
    totalParts: 4,
    paidTransactions: 3,
}];

function renderSection(props = {}) {
    const rendered = render(<MultipartUploadSection {...props} />);
    expect(rendered.container.textContent).not.toMatch(/[A-Z]{2,}_[A-Z_]+/);
    expect(rendered.container.textContent).not.toContain(String.fromCodePoint(8212));
    return rendered;
}

describe('MultipartUploadSection file input', () => {
    it('attaches the ref and forwards a selected File', () => {
        const ref = createRef();
        const onChange = vi.fn();
        const { container } = renderSection({ fileInput: { ref, onChange } });
        const input = container.querySelector('input[type="file"]');
        const file = new File(['pixels'], 'image.png', { type: 'image/png' });

        expect(input).toBe(ref.current);
        expect(input).not.toBeVisible();
        fireEvent.change(input, { target: { files: [file] } });
        expect(onChange).toHaveBeenCalledOnce();
        expect(onChange.mock.calls[0][0].target.files[0]).toBe(file);
    });
});

describe('MultipartUploadSection sending panel', () => {
    it('shows the panel progress text', () => {
        renderSection({ panelProps: { ...progress, stage: 'sending' } });

        expect(screen.getByRole('status')).toHaveTextContent('Uploading part 2 of 4');
        expect(screen.getByRole('status')).toHaveTextContent('4 parts, 11 transactions');
    });
});

describe('MultipartUploadSection assembling panel', () => {
    it('shows the panel assembly text', () => {
        renderSection({ panelProps: { ...progress, stage: 'assembling' } });

        expect(screen.getByRole('status')).toHaveTextContent('Waiting for file assembly');
        expect(screen.getByRole('status')).toHaveTextContent('All 4 parts uploaded');
    });
});

describe('MultipartUploadSection unfinished panel', () => {
    it('shows an unfinished upload without an active upload', () => {
        renderSection({ panelProps: { unfinished } });

        expect(screen.getByRole('article', { name: 'saved.png' }))
            .toHaveTextContent('1 of 4 parts uploaded');
    });
});

describe('MultipartUploadSection null panel props', () => {
    it('does not render a panel', () => {
        const { container } = renderSection({
            panelProps: null,
            fileInput: { ref: createRef(), onChange: vi.fn() },
        });

        expect(screen.queryByRole('status')).toBeNull();
        expect(screen.queryByRole('article')).toBeNull();
        expect(container.querySelector('input[type="file"]')).not.toBeNull();
    });
});

describe('MultipartUploadSection null file input', () => {
    it('does not render an input', () => {
        const { container } = renderSection({
            fileInput: null,
            panelProps: { ...progress, stage: 'sending' },
        });

        expect(container.querySelector('input')).toBeNull();
        expect(screen.getByText('Uploading part 2 of 4')).toBeInTheDocument();
    });
});

describe('MultipartUploadSection resume message', () => {
    it('maps a resume reason to user-facing text', () => {
        renderSection({ resumeReason: 'file_mismatch' });

        expect(screen.getByRole('alert')).toHaveTextContent(
            'Choose the same file you started this upload with.',
        );
    });
});

describe('MultipartUploadSection failure message', () => {
    it('maps an upload error to user-facing text', () => {
        renderSection({ error: { code: 'FILE_UPLOAD_NOT_FOUND' } });

        expect(screen.getByRole('alert')).toHaveTextContent('This upload is no longer saved.');
    });
});

describe('MultipartUploadSection message precedence', () => {
    it('prefers a mapped resume reason over a mapped error and fallback', () => {
        renderSection({
            resumeReason: 'chain_mismatch',
            error: { code: 'FILE_UPLOAD_NOT_FOUND' },
            fallbackMessage: 'The upload could not be completed.',
        });

        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent('Switch to the network this upload started on.');
        expect(alert).not.toHaveTextContent('This upload is no longer saved.');
        expect(screen.getAllByRole('alert')).toHaveLength(1);
    });

    it('prefers a mapped error over fallback text', () => {
        renderSection({
            error: { code: 'MULTIPART_NOT_ACTIVE' },
            listError: new Error('private list detail'),
            fallbackMessage: 'The upload could not be completed.',
        });

        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent('Multi-part file publishing is not available');
        expect(alert).not.toHaveTextContent('The upload could not be completed.');
        expect(screen.getAllByRole('alert')).toHaveLength(1);
    });
});

describe('MultipartUploadSection unmapped error fallback', () => {
    it('shows fallback text without the error details', () => {
        renderSection({
            error: { code: 'PRIVATE_FAILURE', message: 'private error detail' },
            fallbackMessage: 'The upload could not be completed.',
        });

        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent('The upload could not be completed.');
        expect(alert).not.toHaveTextContent('private error detail');
        expect(alert).not.toHaveTextContent('PRIVATE_FAILURE');
    });
});

describe('MultipartUploadSection list error fallback', () => {
    it('shows fallback text without list error details', () => {
        renderSection({
            listError: new Error('private list detail'),
            fallbackMessage: 'The upload list could not be loaded.',
        });

        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent('The upload list could not be loaded.');
        expect(alert).not.toHaveTextContent('private list detail');
    });
});

describe('MultipartUploadSection absent message', () => {
    it('renders no status message when no failure is set', () => {
        const { container } = renderSection();

        expect(screen.queryByRole('alert')).toBeNull();
        expect(container).toBeEmptyDOMElement();
    });

    it('renders no status message when fallback text is empty', () => {
        renderSection({
            error: { code: 'UNKNOWN_FAILURE', message: 'private error detail' },
            listError: new Error('private list detail'),
            fallbackMessage: '',
        });

        expect(screen.queryByRole('alert')).toBeNull();
    });
});
