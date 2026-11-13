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

import { useEffect, useState } from 'react';

const MAX_AGE_MS = 10 * 60 * 1000;
const cache = new Map(); // chainId -> { at, schedule }

function cached(chainId) {
    const hit = chainId ? cache.get(chainId) : null;
    return hit && Date.now() - hit.at < MAX_AGE_MS ? hit.schedule : null;
}

export function useFeeSchedule({ messaging, chainId } = {}) {
    const read = messaging?.getFeeSchedule;
    const [schedule, setSchedule] = useState(() => cached(chainId));

    useEffect(() => {
        let active = true;
        if (!chainId || typeof read !== 'function') {
            setSchedule(null);
            return () => { active = false; };
        }
        const hit = cached(chainId);
        if (hit) {
            setSchedule(hit);
            return () => { active = false; };
        }
        setSchedule(null);
        Promise.resolve(read({ chainId }))
            .then((answer) => {
                const usable = answer && typeof answer === 'object' && !Array.isArray(answer)
                    && answer.gasSchedule ? answer : null;
                if (usable) cache.set(chainId, { at: Date.now(), schedule: usable });
                if (active) setSchedule(usable);
            })
            .catch(() => { if (active) setSchedule(null); });
        return () => { active = false; };
    }, [chainId, read]);

    return schedule;
}
