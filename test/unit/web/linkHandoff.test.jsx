// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { LinkHandoff } from '../../../packages/web/src/routes/LinkHandoff.jsx';

const GET_HREF = 'https://xchain.io/wallet/download/';
const SOURCE_PATH = 'packages/web/src/routes/LinkHandoff.jsx';

function renderPayload(payload) {
    const query = payload == null ? '' : `?uri=${encodeURIComponent(payload)}`;
    window.history.replaceState({}, '', `/link/${query}`);
    return render(<LinkHandoff />);
}

afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
});

describe('<LinkHandoff>', () => {
    it('offers the request link to the app, web wallet, and download page', () => {
        const payload = 'xchain:request?v=1&req=eyJ2IjoxfQ';
        renderPayload(payload);

        expect(screen.getByRole('heading', { name: 'Link actions' })).toBeInTheDocument();
        expect(screen.getByText('Approval Request')).toBeInTheDocument();
        expect(screen.getByLabelText('Link')).toHaveTextContent(payload);
        expect(screen.getByRole('link', { name: 'Open on phone' }))
            .toHaveAttribute('href', payload);
        expect(screen.getByRole('link', { name: 'Open web wallet' }))
            .toHaveAttribute('href', `/?uri=${encodeURIComponent(payload)}`);
        expect(screen.getByRole('link', { name: 'Download' }))
            .toHaveAttribute('href', GET_HREF);
        expect(screen.getByText('Only approve it if you trust the source.')).toBeInTheDocument();
    });

    it.each([
        ['xchain:BTC/send?amount=1', 'send', 'Send'],
        ['xchain:BTC/receive', 'receive', 'Receive'],
        ['xchain:BTC/execute?data=00', 'execute', 'Execute Contract'],
        ['xchain:BTC/swap', 'other', 'Unrecognized link'],
    ])('renders the %s hand-off as %s', (payload, action, copy) => {
        const { container } = renderPayload(payload);

        expect(container.querySelector('section')).toHaveAttribute('data-link-action', action);
        expect(screen.getByText(copy)).toBeInTheDocument();
    });

    it.each([
        [null],
        [''],
        ['bitcoin:BTC/send?amount=1'],
        ['https://example.com/'],
        ['javascript:alert(1)'],
    ])('renders nothing for an unsupported payload %j', (payload) => {
        const { container } = renderPayload(payload);

        expect(container).toBeEmptyDOMElement();
    });

    it('renders the payload as text without forwarding it automatically', () => {
        const payload = 'xchain:request?v=1&req=<img src=x onerror=alert(1)>';
        window.history.replaceState({}, '', `/link/?uri=${encodeURIComponent(payload)}`);
        const before = window.location.href;
        const { container } = render(<LinkHandoff />);

        expect(container.querySelector('img')).toBeNull();
        expect(screen.getByLabelText('Link')).toHaveTextContent(payload);
        expect(window.location.href).toBe(before);
    });

    it('delegates request parsing to the web wallet intake', () => {
        const source = readFileSync(SOURCE_PATH, 'utf8');

        expect(source).not.toMatch(/requestLink\.js|xchainUri\.js/);
        expect(source).not.toMatch(/addEnglish|linkHandoff\./);
        expect(source).not.toMatch(/location\.(?:assign|replace)|location\.href\s*=/);
        expect(source).toContain('linkHandoffModel(location.search)');
    });
});
