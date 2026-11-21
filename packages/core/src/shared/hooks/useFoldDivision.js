// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';

export const NATIVE_FOLD_EVENT = 'xchain:native-fold';

function readFoldDivision() {
    const division = globalThis.__xchainNativeFold?.division;
    const vertical = division?.orientation === 'vertical';
    const horizontal = division?.orientation === 'horizontal';

    return {
        vertical,
        dividerX: vertical && Number.isFinite(division.x) ? division.x : null,
        horizontal,
        divisionY: horizontal && Number.isFinite(division.y) ? division.y : null,
    };
}

export function useFoldDivision() {
    const [fold, setFold] = useState(readFoldDivision);

    useEffect(() => {
        const sync = () => setFold(readFoldDivision());
        globalThis.addEventListener?.(NATIVE_FOLD_EVENT, sync);
        sync();
        return () => globalThis.removeEventListener?.(NATIVE_FOLD_EVENT, sync);
    }, []);

    return fold;
}
