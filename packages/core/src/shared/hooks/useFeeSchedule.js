// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The chain's published fee schedule (gas table, gas price, oracle prices),
// read once per chain and reused for ten minutes. The gas table and gas price
// are consensus constants that move only with a node upgrade; the oracle
// prices behind the native-coin estimate do move, hence the expiry. A failed
// read is not remembered and is tried again next time.

import { useEffect, useRef, useState } from 'react';

const MAX_AGE_MS = 10 * 60 * 1000;
const cache = new Map(); // chainId -> { at, schedule }

function cached(chainId) {
    const hit = chainId ? cache.get(chainId) : null;
    return hit && Date.now() - hit.at < MAX_AGE_MS ? hit.schedule : null;
}

/** Test seam: forget every cached schedule. */
export function __clearFeeScheduleCache() {
    cache.clear();
}

export function useFeeSchedule({ messaging, chainId } = {}) {
    return useFeeScheduleState({ messaging, chainId }).schedule;
}

/**
 * The schedule plus whether a read is still in flight, so a form can say
 * Calculating while it loads and fall back to review pricing only once the
 * read has failed.
 *
 * @returns {{ schedule: object | null, loading: boolean }}
 */
export function useFeeScheduleState({ messaging, chainId } = {}) {
    const read = messaging?.getFeeSchedule;
    const canRead = typeof read === 'function';
    // The read is keyed on the chain alone: a host that hands out a new
    // function on every property read must not trigger a second read.
    const readRef = useRef(read);
    readRef.current = read;
    const [state, setState] = useState(() => {
        const hit = cached(chainId);
        return { schedule: hit, loading: !hit && Boolean(chainId) && canRead };
    });

    useEffect(() => {
        let active = true;
        // An equal state keeps its object, so a re-run never re-renders.
        const put = (schedule, loading) => setState((prev) => (
            prev.schedule === schedule && prev.loading === loading ? prev : { schedule, loading }
        ));
        if (!chainId || !canRead) {
            put(null, false);
            return () => { active = false; };
        }
        const hit = cached(chainId);
        if (hit) {
            put(hit, false);
            return () => { active = false; };
        }
        put(null, true);
        Promise.resolve(readRef.current({ chainId }))
            .then((answer) => {
                const usable = answer && typeof answer === 'object' && !Array.isArray(answer)
                    && answer.gasSchedule ? answer : null;
                if (usable) cache.set(chainId, { at: Date.now(), schedule: usable });
                if (active) put(usable, false);
            })
            .catch(() => { if (active) put(null, false); });
        return () => { active = false; };
    }, [chainId, canRead]);

    return state;
}
