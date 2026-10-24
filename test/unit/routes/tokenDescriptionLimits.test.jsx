// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The indexer refuses a DESCRIPTION of 250 or more UTF-16 code units, and the
// SDK refuses a pipe or semicolon in it. Left alone, the first reaches the
// user as a failed broadcast and the second as a generic "something went
// wrong"; the forms name the cause beside the field before anything is composed.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { IssueTokenForm } from '../../../packages/core/src/shared/routes/IssueTokenForm.jsx';
import { TokenAdminForm } from '../../../packages/core/src/shared/routes/TokenAdminForm.jsx';
import { TokenWizard } from '../../../packages/core/src/shared/routes/TokenWizard.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import {
    MAX_ISSUE_TEXT_LENGTH,
    MAX_TOKEN_SUPPLY,
    issueDescriptionError,
    issueImageUrlError,
    issueSupplyLimitError,
} from '../../../packages/core/src/shared/utils/issueFieldValidation.js';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = {
    id: 'addr-1',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02ab',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

function messagingFor(extra = {}) {
    const composeForConfirm = vi.fn().mockResolvedValue({
        psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 0,
    });
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: SOURCE }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getTokenInfo: vi.fn().mockResolvedValue({ chainId: CHAIN, tick: 'OWNED', divisibility: 0, locks: {} }),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 900000 }),
        listContacts: vi.fn().mockResolvedValue([]),
        composeForConfirm,
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        issueToken: vi.fn().mockResolvedValue({ txid: 'deadbeef' }),
        ...extra,
    };
    const messaging = new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue([]);
        },
    });
    return { messaging, composeForConfirm };
}

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('issueDescriptionError', () => {
    it('accepts text up to the indexer ceiling', () => {
        expect(issueDescriptionError('a'.repeat(MAX_ISSUE_TEXT_LENGTH))).toBeNull();
        expect(issueDescriptionError('')).toBeNull();
    });

    it('refuses the 250th code unit, pipes and semicolons', () => {
        expect(issueDescriptionError('a'.repeat(MAX_ISSUE_TEXT_LENGTH + 1)))
            .toBe('Description cannot be longer than 249 characters.');
        expect(issueDescriptionError('a|b')).toBe('Description cannot contain | or ; characters.');
        expect(issueDescriptionError('a;b')).toBe('Description cannot contain | or ; characters.');
    });

    it('counts UTF-16 code units, as the indexer does', () => {
        expect(issueDescriptionError('\u{1F600}'.repeat(125))).toBe('Description cannot be longer than 249 characters.');
        expect(issueDescriptionError('\u{1F600}'.repeat(124))).toBeNull();
    });
});

describe('IssueTokenForm description rules', () => {
    async function submitWith(description) {
        const { messaging, composeForConfirm } = messagingFor();
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <IssueTokenForm walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );
        fireEvent.change(await screen.findByLabelText('Ticker'), { target: { value: 'OWNED' } });
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '10' } });
        fireEvent.change(screen.getByLabelText('Description (optional)'), { target: { value: description } });
        fireEvent.click(screen.getByRole('button', { name: 'Issue token' }));
        return composeForConfirm;
    }

    it('refuses a pipe in the description with a named cause', async () => {
        const composeForConfirm = await submitWith('a|b');
        expect(await screen.findByRole('alert')).toHaveTextContent('Description cannot contain | or ; characters.');
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('refuses a 250 character description', async () => {
        const composeForConfirm = await submitWith('x'.repeat(250));
        expect(await screen.findByRole('alert')).toHaveTextContent('Description cannot be longer than 249 characters.');
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('composes a 249 character description', async () => {
        const composeForConfirm = await submitWith('x'.repeat(249));
        await waitFor(() => expect(composeForConfirm).toHaveBeenCalled());
    });
});

describe('TokenAdminForm description rules', () => {
    it('refuses a semicolon in a replacement description', async () => {
        // The admin form is owner-only, so SOURCE is named as the issuer.
        const { messaging, composeForConfirm } = messagingFor({
            getTokenInfo: vi.fn().mockResolvedValue({ chainId: CHAIN, tick: 'OWNED', divisibility: 0, locks: {}, creator: SOURCE.address }),
        });
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <TokenAdminForm
                    walletId="w"
                    mode="description"
                    initialChainId={CHAIN}
                    initialTick="OWNED"
                    initialFromAddress={SOURCE.address}
                    onBack={() => {}}
                />
            </MessagingProvider>,
        );
        fireEvent.change(await screen.findByLabelText('New description'), { target: { value: 'one;two' } });
        const button = screen.getByRole('button', { name: /update token/i });
        await waitFor(() => expect(button).toBeEnabled());
        fireEvent.click(button);

        expect(await screen.findByRole('alert')).toHaveTextContent('Description cannot contain | or ; characters.');
        expect(composeForConfirm).not.toHaveBeenCalled();
    });
});

describe('collectible image URL', () => {
    it('accepts the schemes the wallet can draw', () => {
        expect(issueImageUrlError('https://example.com/a.png')).toBeNull();
        expect(issueImageUrlError('http://example.com/a.png')).toBeNull();
        expect(issueImageUrlError('ipfs://bafyexample/a.png')).toBeNull();
        expect(issueImageUrlError('ar:abc123')).toBeNull();
    });

    it('refuses script links, data links and plain text', () => {
        for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'not a url at all', 'https://a b']) {
            expect(issueImageUrlError(bad)).toMatch(/^Image URL (must use|cannot contain)/);
        }
    });

    async function submitCollectible(url) {
        const { messaging, composeForConfirm } = messagingFor();
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <TokenWizard walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );
        fireEvent.click(await screen.findByText('Collectible'));
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        fireEvent.change(await screen.findByLabelText('Token name (ticker)'), { target: { value: 'ART' } });
        fireEvent.change(screen.getByLabelText('Image URL'), { target: { value: url } });
        fireEvent.click(screen.getByRole('button', { name: 'Review token' }));
        return composeForConfirm;
    }

    it('keeps a javascript: link out of the collectible wizard', async () => {
        const composeForConfirm = await submitCollectible('javascript:alert(1)');
        expect(await screen.findByRole('alert')).toHaveTextContent('Image URL must use http, https, ipfs, or ar.');
        expect(screen.queryByRole('button', { name: 'Continue to confirmation' })).toBeNull();
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('lets an https image through to the review step', async () => {
        await submitCollectible('https://example.com/art.png');
        expect(await screen.findByRole('button', { name: 'Continue to confirmation' })).toBeTruthy();
    });
});

describe('supply ceiling', () => {
    it('accepts the ceiling and refuses one unit above it', () => {
        expect(issueSupplyLimitError(MAX_TOKEN_SUPPLY)).toBeNull();
        expect(issueSupplyLimitError('1000000000000000000000.00000001'))
            .toBe('Supply cannot be more than 1,000,000,000,000,000,000,000.');
        expect(issueSupplyLimitError('1000000000000000000001')).toMatch(/cannot be more than/);
        expect(issueSupplyLimitError('5')).toBeNull();
    });

    it('is named beside the field in the standalone issue form', async () => {
        const { messaging, composeForConfirm } = messagingFor();
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <IssueTokenForm walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );
        fireEvent.change(await screen.findByLabelText('Ticker'), { target: { value: 'BIGGER' } });
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '1000000000000000000001' } });
        fireEvent.click(screen.getByRole('button', { name: 'Issue token' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Supply cannot be more than 1,000,000,000,000,000,000,000.');
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('is named on the wizard details step', async () => {
        const { messaging, composeForConfirm } = messagingFor();
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <TokenWizard walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );
        fireEvent.click(await screen.findByText('Custom'));
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        fireEvent.change(await screen.findByLabelText('Token name (ticker)'), { target: { value: 'BIGGER' } });
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '1000000000000000000001' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review token' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Supply cannot be more than');
        expect(screen.queryByRole('button', { name: 'Continue to confirmation' })).toBeNull();
        expect(composeForConfirm).not.toHaveBeenCalled();
    });
});
