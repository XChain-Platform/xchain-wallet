// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it } from 'vitest';
import { checkRecipientNovelty } from '../../../packages/core/src/flows/recipientNovelty.js';

describe('checkRecipientNovelty', () => {
    it('recognizes a contact only on the active coin family', () => {
        const contacts = [{
            name: 'Alice',
            entries: [{ chain: 'bitcoin', address: 'shared-address' }],
        }];

        expect(checkRecipientNovelty({
            address: 'shared-address',
            chainCoin: 'bitcoin',
            contacts,
        })).toEqual({ everSentTo: false, knownAsContact: true, novel: false });

        expect(checkRecipientNovelty({
            address: 'shared-address',
            chainCoin: 'litecoin',
            contacts,
        })).toEqual({ everSentTo: false, knownAsContact: false, novel: true });
    });

    it.each([
        [{ action: 'SEND', destination: 'recipient' }, 'destination'],
        [{ ACTION: 'send', DESTINATION: 'recipient' }, 'DESTINATION'],
        [{ action: 'Send', recipient: 'recipient' }, 'recipient'],
    ])('recognizes SEND history through the %s field', (row) => {
        expect(checkRecipientNovelty({
            address: 'recipient',
            historyRows: [row],
        })).toEqual({ everSentTo: true, knownAsContact: false, novel: false });
    });

    it('ignores matching destinations on non-send actions', () => {
        expect(checkRecipientNovelty({
            address: 'recipient',
            historyRows: [
                { action: 'ISSUE', destination: 'recipient' },
                { action: 'ORDER', recipient: 'recipient' },
            ],
        })).toEqual({ everSentTo: false, knownAsContact: false, novel: true });
    });

    it.each([undefined, null, '', 123])('does not flag missing address value %s as novel', (address) => {
        expect(checkRecipientNovelty({ address })).toEqual({
            everSentTo: false,
            knownAsContact: false,
            novel: false,
        });
    });

    it('reports a destination absent from both sources as novel', () => {
        expect(checkRecipientNovelty({
            address: 'new-recipient',
            chainCoin: 'bitcoin',
            contacts: [{ entries: [{ chain: 'bitcoin', address: 'known-recipient' }] }],
            historyRows: [{ action: 'SEND', destination: 'past-recipient' }],
        })).toEqual({ everSentTo: false, knownAsContact: false, novel: true });
    });
});
