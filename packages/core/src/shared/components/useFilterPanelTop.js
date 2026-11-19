// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useLayoutEffect, useState } from 'react';

/**
 * Where a filter panel's top edge sits on a narrow screen: just under its
 * trigger, so the panel reads as the trigger's and the search box stays
 * within the thumb's reach, while the panel itself is centred across the
 * screen. Tracks scroll and resize while open; null when closed.
 */
export function useFilterPanelTop(open, triggerRef, gap = 8) {
    const [top, setTop] = useState(null);
    useLayoutEffect(() => {
        if (!open) {
            setTop(null);
            return undefined;
        }
        const measure = () => {
            const rect = triggerRef.current?.getBoundingClientRect?.();
            if (rect) setTop(Math.round(rect.bottom + gap));
        };
        measure();
        window.addEventListener('resize', measure);
        window.addEventListener('scroll', measure, true);
        return () => {
            window.removeEventListener('resize', measure);
            window.removeEventListener('scroll', measure, true);
        };
    }, [open, triggerRef, gap]);
    return top;
}
