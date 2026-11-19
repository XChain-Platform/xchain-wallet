// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { estimateNativeSendFeeTiers } from '../../../packages/core/src/flows/feeEstimate.js';
import {
    UploadMethodField,
    UploadMethodReviewRows,
    useUploadMethod,
} from '../../../packages/core/src/shared/components/UploadMethodField.jsx';

const registry = defaultRegistry();
const BTC = registry.get('bitcoin-mainnet');
const tiers = estimateNativeSendFeeTiers({ chainId: 'bitcoin-mainnet', chainRegistry: registry });
const FILE = { name: 'large.bin', type: 'application/octet-stream', bytes: new Uint8Array(20_000) };
const HD = { id: 'a1', address: 'bc1qexample', source: 'hd' };

afterEach(cleanup);

function baseArgs(multipart, overrides = {}) {
    return {
        descriptor: BTC,
        fromAddress: HD,
        feeEstimate: tiers.normal,
        coinTicker: 'BTC',
        file: FILE,
        metadata: { title: '', memo: '' },
        compiledBytesFor: () => FILE.bytes.length,
        standardCap: 8_000,
        multipart,
        ...overrides,
    };
}

function option({ reason = null, cap = null, summary = null, fee = null } = {}) {
    return {
        reason, cap, multipart: Boolean(summary), pending: false, summary, fee,
    };
}

function multipart(taproot, standard, reasons = null) {
    return {
        options: { taproot, standard },
        reasons: reasons ?? { taproot: taproot.reason, standard: standard.reason },
        ready: true,
        loading: false,
        error: null,
    };
}

function Harness({ quote, overrides }) {
    const upload = useUploadMethod(baseArgs(quote, overrides));
    return <UploadMethodField upload={upload} />;
}

function openOptions() {
    fireEvent.click(screen.getByRole('button', { name: /^Upload method: / }));
    return screen.getAllByRole('option');
}

describe('multipart quote integration', () => {
    it('shows each quote summary and fee and clears the single-transaction size reason', () => {
        const quote = multipart(
            option({ summary: '2 parts, 7 transactions', fee: 12_345 }),
            option({ summary: '4 parts, 11 transactions', fee: 67_890 }),
        );
        render(<Harness quote={quote} />);

        const [taproot, standard] = openOptions();
        expect(taproot).toHaveTextContent('2 parts, 7 transactions');
        expect(taproot).toHaveTextContent('Network fee about 0.00012345 BTC');
        expect(standard).toHaveTextContent('4 parts, 11 transactions');
        expect(standard).toHaveTextContent('Network fee about 0.0006789 BTC');
        expect(taproot).not.toHaveAttribute('aria-disabled');
        expect(standard).not.toHaveAttribute('aria-disabled');
    });
});

describe('multipart disabled reason integration', () => {
    it('uses multipart reasons for method selection and method-specific cap copy', () => {
        const quote = multipart(
            option({ reason: 'hardware' }),
            option({ reason: 'tooLarge', cap: 122_880 }),
        );
        render(<Harness quote={quote} />);

        expect(screen.getByRole('button', { name: 'Upload method: Standard' })).toBeEnabled();
        const [taproot, standard] = openOptions();
        expect(taproot).toHaveAttribute('aria-disabled', 'true');
        expect(taproot).toHaveTextContent("Hardware wallets can't sign the reveal transaction yet.");
        expect(standard).toHaveAttribute('aria-disabled', 'true');
        expect(standard).toHaveTextContent('Too large for this method: it carries up to 120 KB.');
    });
});

describe('multipart option reason fallback', () => {
    it('adopts option reasons when the hook result omits its reasons pair', () => {
        const quote = {
            options: {
                taproot: option({ reason: 'watcher' }),
                standard: option({ summary: '3 parts, 9 transactions', fee: 500 }),
            },
        };
        render(<Harness quote={quote} />);

        expect(screen.getByRole('button', { name: 'Upload method: Standard' })).toBeEnabled();
        const [taproot, standard] = openOptions();
        expect(taproot).toHaveAttribute('aria-disabled', 'true');
        expect(standard).not.toHaveAttribute('aria-disabled');
        expect(standard).toHaveTextContent('3 parts, 9 transactions');
    });
});

function ReviewHarness({ quote }) {
    const upload = useUploadMethod(baseArgs(quote));
    return <dl><UploadMethodReviewRows upload={upload} /></dl>;
}

describe('multipart review rows', () => {
    it('names the parts and transactions of a multipart pick and its whole fee', () => {
        const quote = multipart(
            option({ summary: '26 parts, 55 transactions', fee: 12_345 }),
            option({ reason: 'tooLarge', cap: 122_880 }),
        );
        render(<ReviewHarness quote={quote} />);

        expect(screen.getByTestId('review-upload-method')).toHaveTextContent('Taproot upload, 26 parts, 55 transactions');
        expect(screen.getByTestId('review-upload-fee')).toHaveTextContent('0.00012345 BTC');
    });

    it('keeps the method name alone for a single-transaction pick', () => {
        const quote = multipart(option(), option());
        render(<ReviewHarness quote={quote} />);

        expect(screen.getByTestId('review-upload-method').textContent).toMatch(/^(Taproot upload|Standard)$/);
    });
});
