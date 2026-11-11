// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useLayoutEffect, useRef, useState } from 'react';
import styles from './AddressText.module.css';

/**
 * Keeps both identifying ends of a long address visible.
 *
 * @param {string} address
 * @returns {string}
 */
export function truncateAddress(address) {
    if (typeof address !== 'string' || address.length <= 14) {
        return address;
    }
    return `${address.slice(0, 6)}…${address.slice(-6)}`;
}

/**
 * Monospace address display.
 *
 * Long identifiers render as `first6…last6` unless the context explicitly
 * requires the full value. Focusing a truncated value reveals the full
 * identifier without wrapping it, and copying always writes the full value.
 *
 * - When `highlight` is set, the address renders as three spans:
 *   first 6 (head, accent) / middle (muted) / last 6 (tail, accent).
 *   This is the §21.5 "checksum-positional highlighting" treatment.
 *   The head and tail still mark the identifying ends, with the muted
 *   middle pointing at the elided characters.
 *
 * @param {object} props
 * @param {string} props.address
 * @param {boolean} [props.truncate]
 * @param {boolean} [props.highlight]
 * @param {'sm' | 'md'} [props.size]
 * @param {string} [props.className]
 * @param {boolean} [props.focusable]   false when a focusable control already owns the value, such as a read-only field's preview
 * @param {boolean} [props.fit] show the full address when it fits and trim only
 *   as much of the middle as the containing box requires
 */
// A control inside a button, link or menu row is not a second tab stop: the
// enclosing control is the one stop and nesting focusable content in it is invalid.
const INTERACTIVE_ANCESTOR = 'button, a[href], summary, [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"]';

export function AddressText({
    address,
    truncate = true,
    highlight = false,
    size = 'md',
    className = '',
    focusable = true,
    fit = false,
}) {
    const [focused, setFocused] = useState(false);
    const [nested, setNested] = useState(false);
    const [fitted, setFitted] = useState(null);
    const ref = useRef(null);
    const measureRef = useRef(null);
    useLayoutEffect(() => {
        const el = ref.current;
        setNested(Boolean(el?.parentElement?.closest(INTERACTIVE_ANCESTOR)));
    });
    useLayoutEffect(() => {
        if (!fit || !truncate || highlight || typeof address !== 'string' || address.length <= 14) {
            setFitted(null);
            return undefined;
        }
        const element = ref.current;
        const box = element?.parentElement;
        const measure = measureRef.current;
        if (!box || !measure) return undefined;

        const update = () => {
            const width = box.clientWidth;
            const value = width > 0 ? fitAddressToWidth(address, width, measure) : null;
            setFitted((current) => (
                current?.address === address && current.value === value
                    ? current
                    : { address, value }
            ));
        };
        update();
        const Observer = globalThis.ResizeObserver;
        if (typeof Observer !== 'function') return undefined;
        const observer = new Observer(update);
        observer.observe(box);
        return () => observer.disconnect();
    }, [address, fit, highlight, truncate]);
    const cls = `${styles.addr} ${styles[size]} ${className}`.trim();
    if (typeof address !== 'string' || address.length === 0) {
        return <span className={cls} dir="ltr">…</span>;
    }
    if (address.length <= 14) {
        return (
            <span className={cls} title={address} aria-label={address} dir="ltr">
                {address}
            </span>
        );
    }
    const head = address.slice(0, 6);
    const tail = address.slice(-6);
    const middleFull = address.slice(6, -6);
    // Only a truncated value is held to one line. A full value (truncate=false)
    // wraps, so a read-only Receive field never clips the address.
    const displayStyle = !truncate ? { overflowWrap: 'anywhere' } : {
        display: 'inline-block',
        maxWidth: '100%',
        overflowX: focused ? 'auto' : 'hidden',
        verticalAlign: 'bottom',
        whiteSpace: 'nowrap',
        wordBreak: 'normal',
    };
    const commonProps = {
        ref,
        className: cls,
        title: address,
        'aria-label': address,
        dir: 'ltr',
        // A preview drawn over a focusable input stays out of the tab order:
        // the input is the one stop for that value.
        tabIndex: focusable && !nested ? 0 : undefined,
        style: displayStyle,
        onFocus: focusable ? () => setFocused(true) : undefined,
        onBlur: focusable ? () => setFocused(false) : undefined,
        onCopy: (event) => {
            if (event.clipboardData) {
                event.clipboardData.setData('text/plain', address);
                event.preventDefault();
            }
        },
    };
    if (!highlight) {
        const fittedValue = fitted?.address === address ? fitted.value : null;
        const displayed = focused || !truncate
            ? address
            : (fit && fittedValue) || truncateAddress(address);
        return (
            <span {...commonProps}>
                {displayed}
                {fit && truncate ? (
                    <span ref={measureRef} className={styles.measure} aria-hidden="true" data-address-measure />
                ) : null}
            </span>
        );
    }
    return (
        <span {...commonProps}>
            <span className={styles.head}>{head}</span>
            <span className={styles.middle}>{focused || !truncate ? middleFull : '…'}</span>
            <span className={styles.tail}>{tail}</span>
        </span>
    );
}

function fitAddressToWidth(address, width, measure) {
    const measuredWidth = (value) => {
        measure.textContent = value;
        const rectWidth = measure.getBoundingClientRect().width;
        return rectWidth || measure.scrollWidth;
    };

    try {
        if (measuredWidth(address) <= width) return address;
        let low = 0;
        let high = Math.floor((address.length - 1) / 2);
        while (low < high) {
            const count = Math.ceil((low + high) / 2);
            const candidate = `${address.slice(0, count)}…${address.slice(-count)}`;
            if (measuredWidth(candidate) <= width) low = count;
            else high = count - 1;
        }
        return low > 0
            ? `${address.slice(0, low)}…${address.slice(-low)}`
            : '…';
    } finally {
        measure.textContent = '';
    }
}
