// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

export const REJECTED_FEED_STATUS = 'invalid';
export const REJECTED_FEED_LABEL = 'Rejected, never opened';

export function isRejectedFeedStatus(status) {
    return String(status ?? '').trim().toLowerCase() === REJECTED_FEED_STATUS;
}

export function isRejectedFeed(row) {
    return isRejectedFeedStatus(row?.feed_status);
}
