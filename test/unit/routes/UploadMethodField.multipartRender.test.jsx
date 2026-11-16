// Copyright © 2025–2026 Dankest, LLC
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { estimateNativeSendFeeTiers } from '../../../packages/core/src/flows/feeEstimate.js';
import {
    UploadMethodField,
    useUploadMethod,
} from '../../../packages/core/src/shared/components/UploadMethodField.jsx';

const registry = defaultRegistry();
const BTC = registry.get('bitcoin-mainnet');
const tiers = estimateNativeSendFeeTiers({ chainId: 'bitcoin-mainnet', chainRegistry: registry });
const HD = { id: 'a1', address: 'bc1qexample', source: 'hd' };
const FILE = { name: 'art.png', type: 'image/png', bytes: new Uint8Array(2000) };
const EMPTY_OPTION = Object.freeze({
    reason: null, cap: null, multipart: false, pending: false, summary: null, fee: null,
});

afterEach(cleanup);

function baseArgs() {
    return {
        descriptor: BTC,
        fromAddress: HD,
        feeEstimate: tiers.normal,
        coinTicker: 'BTC',
        file: FILE,
        metadata: { title: '', memo: '' },
        compiledBytesFor: () => 2000,
        standardCap: 8000,
    };
}

function Harness({ multipart, reasons }) {
    const upload = useUploadMethod(baseArgs());
    const rendered = {
        ...upload,
        ...(reasons ? { reasons } : {}),
        ...(multipart !== undefined ? { multipart } : {}),
    };
    return <UploadMethodField upload={rendered} />;
}

function options() {
    fireEvent.click(screen.getByRole('button', { name: /^Upload method: / }));
    return screen.getAllByRole('option');
}

function multipart(taproot, standard = EMPTY_OPTION) {
    return { options: { taproot: { ...EMPTY_OPTION, ...taproot }, standard } };
}

describe('multipart quote rendering', () => {
    it('shows the multipart summary and fee instead of the single-transaction fee', () => {
        render(<Harness multipart={multipart({
            multipart: true, summary: '3 parts, 9 transactions', fee: 123_456_789,
        })} />);
        const [taproot] = options();
        expect(taproot.querySelector('[data-upload-description]'))
            .toHaveTextContent('3 parts, 9 transactions');
        expect(taproot.querySelector('[data-upload-fee="taproot"]'))
            .toHaveTextContent('Network fee about 1.23456789 BTC');
        expect(taproot.querySelectorAll('[data-upload-fee]')).toHaveLength(1);
    });

    it('omits a multipart fee that is not finite', () => {
        render(<Harness multipart={multipart({
            multipart: true, summary: '3 parts, 9 transactions', fee: Number.NaN,
        })} />);
        const [taproot] = options();
        expect(taproot).toHaveTextContent('3 parts, 9 transactions');
        expect(taproot.querySelector('[data-upload-fee]')).toBeNull();
    });
});

describe('multipart quote pending rendering', () => {
    it('shows the pending copy without a fee', () => {
        render(<Harness multipart={multipart({ multipart: true, pending: true })} />);
        const [taproot] = options();
        expect(taproot.querySelector('[data-upload-description]'))
            .toHaveTextContent('Working out the parts and the fee.');
        expect(taproot.querySelector('[data-upload-fee]')).toBeNull();
    });
});

describe('multipart cap reason rendering', () => {
    it('shows each method-specific cap', () => {
        const uploadMultipart = {
            options: {
                taproot: { ...EMPTY_OPTION, cap: 307_200 },
                standard: { ...EMPTY_OPTION, cap: 122_880 },
            },
        };
        const reasons = { taproot: 'tooLarge', standard: 'tooLarge' };
        render(<Harness multipart={uploadMultipart} reasons={reasons} />);
        const [taproot, standard] = options();
        expect(taproot).toHaveTextContent('Too large for this method: it carries up to 300 KB.');
        expect(standard).toHaveTextContent('Too large for this method: it carries up to 120 KB.');
        expect(taproot).toHaveAttribute('aria-disabled', 'true');
        expect(standard).toHaveAttribute('aria-disabled', 'true');
    });
});

describe('disabled multipart option rendering', () => {
    it('uses the upload reason instead of the multipart summary', () => {
        const reasons = { taproot: 'signer', standard: null };
        render(<Harness
            multipart={multipart({ multipart: true, summary: '3 parts, 9 transactions', fee: 500 })}
            reasons={reasons}
        />);
        const [taproot] = options();
        expect(taproot).toHaveTextContent("This From address can't sign the reveal transaction.");
        expect(taproot).not.toHaveTextContent('3 parts, 9 transactions');
        expect(taproot).toHaveAttribute('aria-disabled', 'true');
    });

    it('does not use a multipart option reason to disable the method', () => {
        render(<Harness multipart={multipart({
            reason: 'tooLarge', multipart: true, summary: '3 parts, 9 transactions', fee: 500,
        })} />);
        const [taproot] = options();
        expect(taproot).toHaveTextContent('3 parts, 9 transactions');
        expect(taproot).not.toHaveAttribute('aria-disabled');
    });
});

describe('missing multipart rendering', () => {
    it('renders null multipart exactly like an absent multipart key', () => {
        render(<Harness />);
        const absent = options().map((option) => option.textContent);
        cleanup();
        render(<Harness multipart={null} />);
        const presentNull = options().map((option) => option.textContent);
        expect(presentNull).toEqual(absent);
    });
});
