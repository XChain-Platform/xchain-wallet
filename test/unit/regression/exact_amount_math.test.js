// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { fiatToCoin } from '../../../packages/core/src/flows/priceLookup.js';
import { customFeeEstimate } from '../../../packages/core/src/flows/feeEstimate.js';
import { exactNetworkFeeSats } from '../../../packages/core/src/flows/psbtNetworkFee.js';
import { classifySignRisk } from '../../../packages/core/src/flows/signRiskClassifier.js';
import { decodeAction } from '../../../packages/core/src/decoder/actionDecoder.js';
import { normalizeOrderbook } from '../../../packages/core/src/market/orderbook.js';
import { bucketizeMatches } from '../../../packages/core/src/market/bucketize.js';
import { PsbtIntentPanel } from '../../../packages/core/src/shared/components/PsbtIntentPanel.jsx';
import {
    fiatValue,
    formatFiat,
    sumFiatValue,
} from '../../../packages/core/src/shared/components/BalanceList.jsx';
import {
    compareDecimalStrings,
    decimalQuotientFloor,
    divideDecimalStrings,
    formatWithThousands,
    multiplyDecimalStrings,
    subtractDecimalStrings,
    sumDecimalStrings,
} from '../../../packages/core/src/shared/utils/amountFormat.js';

const DOGE_REGISTRY = {
    get() {
        return { coin: 'dogecoin', feeStrategy: { unit: 'sats-per-kbyte' } };
    },
};

describe('exact signed and safety amount math', () => {
    it('rounds fiat conversion half up without losing a satoshi', () => {
        expect(fiatToCoin('29.91', { rate: 25523.20 })).toBe('0.00117188');
    });

    it('compares send risk amounts and thresholds above the safe integer limit', () => {
        const result = classifySignRisk({
            signerKind: 'ledger',
            amountSats: '9007199254740993',
            settings: { testSendThresholdSats: '9007199254740992' },
        });
        expect(result.requireExplicitConfirm).toBe(true);
    });

    it('computes a safe fee from string-valued PSBT amounts above 2^53', () => {
        expect(exactNetworkFeeSats({
            inputs: [{ value: '9007199254740993' }],
            outputs: [{ value: '9007199254740000' }],
        })).toBe(993);
    });

    it('shows large string-valued PSBT amounts as known on the signing screen', () => {
        const utils = render(React.createElement(PsbtIntentPanel, {
            decomposed: {
                inputs: [{ address: 'mine', value: '9007199254740993' }],
                outputs: [{ address: 'theirs', value: '9007199254740000' }],
            },
            ownAddresses: new Set(['mine']),
            signingAddress: 'mine',
            decodedAction: { summary: 'x' },
        }));
        const text = utils.container.textContent;
        expect(text).toContain('9,007,199,254,740,993 sats');
        expect(text).toContain('993 sats');
        expect(text).not.toContain('amount unknown');
    });
});

describe('exact fee and action review math', () => {
    it('ceil-divides a DOGE per-kilobyte fee without float overshoot', () => {
        const estimate = customFeeEstimate({
            chainId: 'dogecoin-mainnet',
            chainRegistry: DOGE_REGISTRY,
            rate: '0.00004',
        });
        expect(estimate.sats).toBe(1000);
    });

    it('shows all fills for decimal escrow', () => {
        const decoded = decodeAction({
            action: 'DISPENSER',
            params: { GIVE_AMOUNT: '0.1', GIVE_ESCROW: '0.3' },
        });
        expect(decoded.details.find((row) => row.label === 'Estimated fills')?.value).toBe('3');
    });

    it('rounds the oracle fee percentage from its exact decimal fraction', () => {
        const decoded = decodeAction({
            action: 'PRICE',
            params: { VERSION: '1', FEE: '0.04985000' },
        });
        expect(decoded.details.find((row) => row.label === 'Oracle usage fee')?.value)
            .toContain('(4.99%');
    });
});

describe('exact market and fiat display math', () => {
    it('retains a one-unit orderbook increment above 2^53', () => {
        const book = normalizeOrderbook({
            bids: [['1', '9007199254740992'], ['0.5', '1']],
            asks: [],
        });
        expect(book.bids[1].cumulative).toBe('9007199254740993');
        expect(book.maxCumulative).toBe('9007199254740993');
    });

    it('aggregates chart volume exactly before producing a chart coordinate', () => {
        const candles = bucketizeMatches([
            { give_tick: 'A', get_tick: 'B', give_amount: '9007199254740992', get_amount: '1', timestamp: 1 },
            { give_tick: 'A', get_tick: 'B', give_amount: '1', get_amount: '1', timestamp: 2 },
        ], { tick1: 'A', tick2: 'B', periodSeconds: 60 });
        expect(candles[0].exactVolume).toBe('9007199254740993');
    });

    it('multiplies and sums indivisible fiat quantities without rounding', () => {
        const row = { quantity: '9007199254740993', divisibility: 0, fiatRate: 1 };
        expect(fiatValue(row.quantity, row.divisibility, row.fiatRate))
            .toBe('9007199254740993');
        expect(sumFiatValue([row, { quantity: '1', divisibility: 0, fiatRate: 1 }]).total)
            .toBe('9007199254740994');
        expect(formatFiat('9007199254740993')).toBe('$9,007,199,254,740,993.00');
    });
});

describe('exact issuance and dispenser boundaries', () => {
    it('rejects an initial mint one atomic unit above its cap', () => {
        expect(compareDecimalStrings('90071992.54740902', '90071992.54740901')).toBe(1);
        expect(subtractDecimalStrings('90071992.54740902', '90071992.54740901'))
            .toBe('0.00000001');
    });

    it('orders mint limits that differ by one atomic unit', () => {
        expect(compareDecimalStrings('90071992.54740901', '90071992.54740902')).toBe(-1);
    });

    it('detects insufficient escrow and picks the larger source balance', () => {
        const low = '90071992.54740901';
        const high = '90071992.54740902';
        expect(compareDecimalStrings(low, high)).toBe(-1);
        expect(decimalQuotientFloor('0.3', '0.1')).toBe('3');
    });
});

describe('exact ratio, pool, and staking displays', () => {
    it('rounds a swap ratio half up at eight decimal places', () => {
        expect(divideDecimalStrings('29.91', '25523.20', 8)).toBe('0.00117188');
    });

    it('rounds a 3-of-2000 betting pool share to 0.2 percent', () => {
        const total = sumDecimalStrings(['3', '1997']);
        expect(divideDecimalStrings(multiplyDecimalStrings('3', '100'), total, 1))
            .toBe('0.2');
    });

    it('keeps projected stake below a threshold one atomic unit higher', () => {
        const projected = sumDecimalStrings(['90071992.54740900', '0.00000001']);
        expect(projected).toBe('90071992.54740901');
        expect(compareDecimalStrings(projected, '90071992.54740902')).toBe(-1);
    });
});

describe('exact DEX and raw amount displays', () => {
    it('retains a one-unit filled amount above 2^53', () => {
        expect(subtractDecimalStrings('9007199254740993', '9007199254740992')).toBe('1');
        expect(sumDecimalStrings(['9007199254740992', '1'])).toBe('9007199254740993');
    });

    it('groups a large decimal without converting it to Number', () => {
        expect(formatWithThousands('90071992.54740902')).toBe('90,071,992.54740902');
    });

    it('keeps an indivisible market-cap product above 2^53 exact', () => {
        expect(multiplyDecimalStrings('9007199254740993', '1'))
            .toBe('9007199254740993');
    });
});
