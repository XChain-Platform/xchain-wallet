// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';

const DEFAULT_EVENTS = ['mousedown'];

/**
 * Calls a handler when an event occurs outside every referenced element.
 *
 * @param {Array<import('react').RefObject<Element | null>>} refs
 * @param {(event: Event) => void} onOutside
 * @param {object} [options]
 * @param {string[]} [options.events]
 * @param {'window' | 'document'} [options.target]
 * @param {boolean} [options.capture]
 * @param {boolean} [options.enabled]
 */
export function useOutsidePress(refs, onOutside, {
    events = DEFAULT_EVENTS,
    target = 'window',
    capture = false,
    enabled = true,
} = {}) {
    const refsRef = useRef(refs);
    const onOutsideRef = useRef(onOutside);
    refsRef.current = refs;
    onOutsideRef.current = onOutside;
    const eventKey = events.join('\0');

    useEffect(() => {
        if (!enabled) return undefined;
        const eventTarget = target === 'document' ? document : window;
        const eventNames = eventKey.split('\0');
        const handlePress = (event) => {
            const node = event.target;
            if (node instanceof Node && refsRef.current.some((ref) => ref.current?.contains(node))) return;
            onOutsideRef.current?.(event);
        };

        eventNames.forEach((eventName) => eventTarget.addEventListener(eventName, handlePress, capture));
        return () => {
            eventNames.forEach((eventName) => eventTarget.removeEventListener(eventName, handlePress, capture));
        };
    }, [capture, enabled, eventKey, target]);
}
