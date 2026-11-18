// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useState } from 'react';
import { subscribeRecordChanges } from '../utils/recordChanges.js';

/**
 * A counter that moves each time a record list of `topic` changes, for a
 * list's read effect to depend on. It starts at 0, so the first read is
 * the mount's own and only a later write adds one.
 *
 * @param {string} topic  a RECORD_WRITES topic, or TILE_TOPIC
 * @returns {number}
 */
export function useRecordRevision(topic) {
    const [revision, setRevision] = useState(0);
    useEffect(() => subscribeRecordChanges((changed) => {
        if (changed === topic) setRevision((n) => n + 1);
    }), [topic]);
    return revision;
}
