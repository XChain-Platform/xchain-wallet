// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it } from 'vitest';
import {
    buildRecentDestinations,
    filterSuggestions,
} from '../../../packages/core/src/flows/recentDestinations.js';

describe('buildRecentDestinations', () => {
    it('ranks current-chain contacts first and keeps cross-chain context', () => {
        const result = buildRecentDestinations({
            chainCoin: 'bitcoin',
            contacts: [
                {
                    name: ' Alice ',
                    entries: [
                        { chain: 'litecoin', address: ' ltc-alice ', label: 'Savings' },
                        { chain: 'bitcoin', address: ' btc-alice ', label: 'Everyday' },
                    ],
                },
                {
                    name: '',
                    entries: [{ chain: 'dogecoin', address: 'doge-tip', label: 'Tip jar' }],
                },
            ],
        });

        expect(result).toEqual([
            {
                address: 'btc-alice',
                label: 'Alice',
                sublabel: 'Everyday',
                source: 'contact',
            },
            {
                address: 'ltc-alice',
                label: 'Alice',
                sublabel: 'Litecoin · Savings',
                source: 'contact',
            },
            {
                address: 'doge-tip',
                label: 'Tip jar',
                sublabel: 'Dogecoin · Tip jar',
                source: 'contact',
            },
        ]);
    });

    it('deduplicates history, prefers contacts, and ranks by recency then frequency', () => {
        const result = buildRecentDestinations({
            chainCoin: 'bitcoin',
            contacts: [{
                name: 'Known',
                entries: [{ chain: 'bitcoin', address: 'known-address' }],
            }],
            historyRows: [
                { action: 'SEND', destination: 'frequent-address', timestamp: 20 },
                { action: 'send', recipient: 'recent-address', timestamp: 30 },
                { ACTION: 'SEND', DESTINATION: 'frequent-address', block_time: 20 },
                { action: 'SEND', destination: 'known-address', timestamp: 100 },
                { action: 'ISSUE', destination: 'ignored-address', timestamp: 200 },
            ],
        });

        expect(result.map(({ address }) => address)).toEqual([
            'known-address',
            'recent-address',
            'frequent-address',
        ]);
        expect(result[0].source).toBe('contact');
        expect(result[1]).toMatchObject({ count: 1, lastSentAt: 30 });
        expect(result[2]).toMatchObject({ count: 2, lastSentAt: 20 });
    });

    it('applies the history limit to the input window', () => {
        const result = buildRecentDestinations({
            historyLimit: 2,
            historyRows: [
                { action: 'ISSUE', destination: 'ignored' },
                { action: 'SEND', destination: 'included', timestamp: 1 },
                { action: 'SEND', destination: 'outside-window', timestamp: 2 },
            ],
        });

        expect(result.map(({ address }) => address)).toEqual(['included']);
    });
});

describe('filterSuggestions', () => {
    const suggestions = [
        { address: 'bc1q-alice', label: 'Alice', sublabel: 'Cold storage', source: 'contact' },
        { address: 'bc1q-bob', label: 'Bob', source: 'contact' },
    ];

    it.each([
        ['ALICE', ['bc1q-alice']],
        ['cold', ['bc1q-alice']],
        ['q-bob', ['bc1q-bob']],
        ['missing', []],
    ])('filters %s across display text and address', (query, addresses) => {
        expect(filterSuggestions(suggestions, query).map(({ address }) => address))
            .toEqual(addresses);
    });

    it('returns the original list for a blank query', () => {
        expect(filterSuggestions(suggestions, '   ')).toBe(suggestions);
    });
});
