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
import kindsMap from '../../../packages/core/src/watch/contract/kinds.json';
import { SOUND_FAMILIES } from '../../../packages/core/src/notifications/notificationSounds.js';

const REQUEST_KINDS = ['request', 'paydue'];
const FAMILY_ICONS = {
    txConfirmations: 'SendIcon',
    incomingReceipts: 'DownloadIcon',
    incomingPending: 'ClockIcon',
    messages: 'MessageIcon',
    governancePolls: 'ListIcon',
    deadlines: 'BellIcon',
    dispenserEscrow: 'CoinsIcon',
    dispenserFills: 'TokenIcon',
    orderFills: 'LineChartIcon',
    priceAlerts: 'BellIcon',
};

describe('watch alert kinds map', () => {
    it('has exactly one entry for every sound family', () => {
        const familyKeys = Object.keys(kindsMap).filter((key) => !REQUEST_KINDS.includes(key));
        expect(familyKeys.sort()).toEqual(SOUND_FAMILIES.map(({ key }) => key).sort());
    });

    it('keeps every sound family kind and icon in the watch contract', () => {
        const seenKinds = [];
        for (const family of SOUND_FAMILIES) {
            expect(kindsMap[family.key].kinds, family.key).toEqual([...family.kinds]);
            expect(kindsMap[family.key].icon, family.key).toBe(FAMILY_ICONS[family.key]);
            seenKinds.push(...kindsMap[family.key].kinds);
        }
        expect(seenKinds).toHaveLength(14);
        expect(new Set(seenKinds).size).toBe(14);
    });

    it('includes the request and payment-due kinds with icons', () => {
        expect(kindsMap.request).toEqual({ icon: 'DocumentIcon', kinds: ['request'] });
        expect(kindsMap.paydue).toEqual({ icon: 'ClockIcon', kinds: ['paydue'] });
    });
});
