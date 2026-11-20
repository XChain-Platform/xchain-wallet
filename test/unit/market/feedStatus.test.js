// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import {
    isRejectedFeed, isRejectedFeedStatus, REJECTED_FEED_LABEL,
} from '../../../packages/core/src/market/feedStatus.js';
import { oracleActionLegality } from '../../../packages/core/src/shared/routes/OracleConsole.jsx';

describe('feed status', () => {
    it.each(['invalid', ' INVALID '])('recognises rejected create status %s', (status) => {
        expect(isRejectedFeedStatus(status)).toBe(true);
        expect(isRejectedFeed({ feed_status: status })).toBe(true);
    });

    it.each(['open', 'closed', 'resolved', 'resolved_void', 'cancelled', 'expired', null, undefined, ''])
        ('does not reject market status %s', (status) => {
            expect(isRejectedFeedStatus(status)).toBe(false);
        });

    it('uses a plain rejected-create label', () => {
        expect(REJECTED_FEED_LABEL).toBe('Rejected, never opened');
    });

    it('offers its creator no resolve, cancel or edit on a rejected create', () => {
        const owner = 'bc1qcreatorcreatorcreatorcreatorcreatorcrea';
        const feed = { feed_status: 'invalid', source: owner, owner: { address: owner }, expire_at: 4_000_000_000 };
        expect(oracleActionLegality(feed, 1_800_000_000)).toEqual({ canResolve: false, canCancel: false, canEdit: false });
        expect(oracleActionLegality({ ...feed, feed_status: 'open' }, 1_800_000_000).canCancel).toBe(true);
    });
});
