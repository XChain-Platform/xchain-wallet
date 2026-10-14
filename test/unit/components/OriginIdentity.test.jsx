// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { OriginIdentity } from '../../../packages/core/src/shared/components/OriginIdentity.jsx';

afterEach(cleanup);

describe('OriginIdentity', () => {
    it.each([undefined, null, '', ' \n\t '])('renders nothing without a visible origin for %s', (origin) => {
        const { container } = render(<OriginIdentity origin={origin} />);

        expect(container).toBeEmptyDOMElement();
    });

    it('foregrounds the trailing hostname while retaining the full origin', () => {
        const origin = 'https://login.accounts.example.com:8443/request?scope=wallet';
        render(<OriginIdentity origin={origin} testId="origin-identity" />);

        expect(screen.getByRole('region', { name: 'Requesting site' })).toHaveAttribute(
            'data-testid',
            'origin-identity',
        );
        expect(screen.getByTestId('request-origin-host-ending')).toHaveTextContent('accounts.example.com');
        expect(screen.getByTestId('request-origin-full')).toHaveTextContent(origin);
    });

    it('keeps the complete IPv4 address visible as the host identity', () => {
        render(<OriginIdentity origin="https://192.168.1.100/connect" />);

        expect(screen.getByTestId('request-origin-host-ending')).toHaveTextContent('192.168.1.100');
    });

    it('shows hardened text without inventing a hostname for an invalid origin', () => {
        render(<OriginIdentity origin={'not\u202Ea\u200Burl\nlabel'} />);

        expect(screen.queryByTestId('request-origin-host-ending')).toBeNull();
        expect(screen.getByTestId('request-origin-full')).toHaveTextContent('not␦aurl label');
    });

    it('supports an embedded group and preserves child interactions', () => {
        const onInspect = vi.fn();
        render(
            <OriginIdentity origin="https://wallet.example.com" label="Source" as="div" embedded>
                <button type="button" onClick={onInspect}>Inspect request</button>
            </OriginIdentity>,
        );

        expect(screen.getByRole('group', { name: 'Source' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Inspect request' }));
        expect(onInspect).toHaveBeenCalledOnce();
    });
});
