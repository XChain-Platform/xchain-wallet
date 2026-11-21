// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { parseBip21Uri } from '../../../packages/core/src/uri/bip21.js';
import {
    RECEIVE_QR_ERROR_CORRECTION,
    receiveQrUri,
    requestLabelFor,
} from '../../../packages/core/src/shared/utils/receiveQrUri.js';

const chainId = 'bitcoin-testnet';
const descriptor = defaultRegistry().get(chainId);
const address = 'tb1qreceiveqruritest';
const receiveSource = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/routes/Receive.jsx'),
    'utf8',
);

describe('receiveQrUri', () => {
    it('builds the base payment request from a registry descriptor', () => {
        const parsed = parseBip21Uri(receiveQrUri({
            descriptor,
            chainId,
            address,
            label: 'Savings',
        }));

        expect(parsed).toMatchObject({
            scheme: descriptor.uriScheme,
            address,
            label: 'Savings',
            params: { chain: chainId },
        });
        expect(parsed.amount).toBeUndefined();
        expect(parsed.params.tick).toBeUndefined();
    });

    it('trims the amount and normalizes a token tick', () => {
        const parsed = parseBip21Uri(receiveQrUri({
            descriptor,
            chainId,
            address,
            label: 'Token request',
            amount: ' 1.25 ',
            tick: '  xcp ',
        }));

        expect(parsed.amount).toBe('1.25');
        expect(parsed.params.tick).toBe('XCP');
    });

    it('keeps labels inside the parser limit', () => {
        const label = 'a'.repeat(900);
        const parsed = parseBip21Uri(receiveQrUri({
            descriptor,
            chainId,
            address,
            label,
        }));

        expect(requestLabelFor(label)).toHaveLength(250);
        expect(parsed.label).toBe(requestLabelFor(label));
    });

    it.each([
        [{ chainId, address }],
        [{ descriptor, address }],
        [{ descriptor, chainId }],
    ])('returns null when a required URI part is missing', (input) => {
        expect(receiveQrUri(input)).toBeNull();
    });

    it('shares the QR correction level with the route', () => {
        expect(RECEIVE_QR_ERROR_CORRECTION).toBe('M');
        expect(receiveSource).not.toMatch(/errorCorrectionLevel:\s*'M'/);
    });
});
