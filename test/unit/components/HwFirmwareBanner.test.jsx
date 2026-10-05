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
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const checkFirmware = vi.hoisted(() => vi.fn());

vi.mock('@xchain-wallet/core', () => ({
    signers: { checkFirmware },
}));

import { HwFirmwareBanner } from '../../../packages/core/src/shared/components/HwFirmwareBanner.jsx';

const SIGNER_INFO = {
    vendor: 'ledger',
    model: 'nano-x',
    firmwareVersion: '1.0.0',
};

function setVerdict(status, overrides = {}) {
    const verdict = {
        status,
        detail: null,
        updateUrl: null,
        ...overrides,
    };
    checkFirmware.mockReturnValue(verdict);
    expect(checkFirmware()).toEqual(verdict);
    checkFirmware.mockClear();
}

function renderBanner(signerInfo) {
    return render(<HwFirmwareBanner signerInfo={signerInfo} />);
}

afterEach(() => {
    cleanup();
    checkFirmware.mockReset();
    vi.restoreAllMocks();
});
afterAll(() => { vi.doUnmock('@xchain-wallet/core'); });

describe('HwFirmwareBanner visibility', () => {
    it.each([
        ['no signer information', undefined],
        ['no vendor', { model: 'nano-x', firmwareVersion: '1.0.0' }],
        ['no model', { vendor: 'ledger', firmwareVersion: '1.0.0' }],
    ])('renders nothing with %s', (_label, signerInfo) => {
        const { container } = renderBanner(signerInfo);

        expect(container).toBeEmptyDOMElement();
        expect(checkFirmware).not.toHaveBeenCalled();
    });

    it('renders nothing when the firmware verdict is ok', () => {
        setVerdict('ok');
        const { container } = renderBanner(SIGNER_INFO);

        expect(container).toBeEmptyDOMElement();
        expect(checkFirmware).toHaveBeenCalledWith({
            vendor: 'ledger',
            model: 'nano-x',
            version: '1.0.0',
        });
    });
});

describe('HwFirmwareBanner verdicts', () => {
    it.each([
        ['vulnerable', 'alert', 'Update firmware before signing'],
        ['unsupported', 'alert', 'Unsupported firmware'],
        ['outdated', 'note', 'Firmware update recommended'],
        ['unknown', 'note', 'Firmware status unknown'],
    ])('renders the %s verdict as a %s', (status, role, headline) => {
        setVerdict(status);
        renderBanner(SIGNER_INFO);

        expect(screen.getByRole(role)).toHaveTextContent(headline);
    });

    it('renders verdict detail and a safe vendor update link', () => {
        setVerdict('vulnerable', {
            detail: 'This firmware has a known signing vulnerability.',
            updateUrl: 'https://vendor.example/update',
        });
        renderBanner(SIGNER_INFO);

        const banner = screen.getByRole('alert');
        const detail = banner.querySelector('p');
        const link = screen.getByRole('link', { name: /Open vendor update tool/ });
        expect(detail?.textContent).toBe('This firmware has a known signing vulnerability.');
        expect(link).toHaveTextContent('Open vendor update tool');
        expect(link).toHaveAttribute('href', 'https://vendor.example/update');
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });
});
