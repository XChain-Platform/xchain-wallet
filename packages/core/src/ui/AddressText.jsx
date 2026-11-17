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
 * G99: an address shows in full whenever it fits its room, and is cut in the
 * middle only when it does not, keeping as much of both ends as fits. That is
 * the default (`fit`). Before the first measurement, and wherever there is no
 * width to measure, the value renders as `first6…last6`. Focusing a cut value
 * reveals the full identifier without wrapping it, and copying always writes
 * the full value.
 *
 * - When `highlight` is set, the address renders as three spans:
 *   first 6 (head, accent) / middle (muted) / last 6 (tail, accent).
 *   This is the §21.5 "checksum-positional highlighting" treatment.
 *   The head and tail still mark the identifying ends; the muted middle
 *   holds every character that fits, with the cut (if any) inside it.
 *
 * @param {object} props
 * @param {string} props.address
 * @param {boolean} [props.truncate]    false: always the whole value, wrapping onto more lines if it must
 * @param {boolean} [props.highlight]
 * @param {'sm' | 'md'} [props.size]
 * @param {string} [props.className]
 * @param {boolean} [props.focusable]   false when a focusable control already owns the value, such as a read-only field's preview
 * @param {boolean} [props.fit] default true. The room is the nearest block,
 *   flex or grid box around the address (an inline parent such as a strong or
 *   a span is looked through), less its inline padding. In a row flex box (an
 *   address beside its copy icon) the box's other items and the gaps between
 *   them are taken off first, so the pair fits on one line; in a block box the
 *   other text on the address's line ("Owner: … (you)") is taken off. Give the
 *   box a width of its own (a block, a `minmax(0, 1fr)` cell or a
 *   `flex: 1 1 auto; min-width: 0` item), not shrink-to-content, or the
 *   address keeps its six-and-six form. `fit={false}` keeps the fixed
 *   six-and-six form for a place that must stay short by design.
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
    fit = true,
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
    const fits = fit && truncate && typeof address === 'string' && address.length > 14;
    useLayoutEffect(() => {
        if (!fits) {
            setFitted(null);
            return undefined;
        }
        const element = ref.current;
        const box = roomBox(element);
        const measure = measureRef.current;
        if (!box || !measure) return undefined;

        const update = () => {
            const room = withForm(element, highlight, highlight ? '…' : truncateAddress(address), () => roomWidth(box, element));
            let count = room > 0 ? fitAddressToWidth(address, room, measure) : null;
            // A box sized by its content (a flex item, an inline-flex pair of
            // address and copy icon, a list row's trailing value) is only as
            // wide as the short form, so it is read again with the whole value
            // in place. That reading counts only when it does not push the box
            // out of its parent.
            if (count !== null && count < address.length && sizesToContent(box)) {
                const wide = withForm(element, highlight, highlight ? address.slice(6, -6) : address, () => (
                    overflowsParent(box) ? 0 : roomWidth(box, element)
                ));
                if (wide > room) count = fitAddressToWidth(address, wide, measure);
            }
            setFitted((current) => (
                current?.address === address && current.count === count
                    ? current
                    : { address, count }
            ));
        };
        update();
        const view = element.ownerDocument?.defaultView;
        view?.addEventListener?.('resize', update);
        // A web font that lands after the first paint changes every width.
        let live = true;
        element.ownerDocument?.fonts?.ready?.then?.(() => { if (live) update(); }, () => {});
        const Observer = globalThis.ResizeObserver;
        let observer = null;
        if (typeof Observer === 'function') {
            observer = new Observer(update);
            observer.observe(box);
            // A grid or flex cell held open by a long value does not shrink
            // with the page, but the box around it does: watch that too.
            if (box.parentElement) observer.observe(box.parentElement);
        }
        return () => {
            live = false;
            view?.removeEventListener?.('resize', update);
            observer?.disconnect();
        };
    }, [address, fits, highlight]);
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
        // As a flex item it may shrink below its text until the next fit.
        minWidth: 0,
        verticalAlign: 'bottom',
        whiteSpace: 'nowrap',
        wordBreak: 'normal',
    };
    // How many characters of each end the room holds; address.length means
    // the whole value, null means not measured (the six-and-six form).
    const count = fits && fitted?.address === address ? fitted.count : null;
    const whole = focused || !truncate || (count !== null && count * 2 >= address.length);
    const measureSpan = fits ? (
        <span ref={measureRef} className={styles.measure} aria-hidden="true" data-address-measure />
    ) : null;
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
        let displayed = truncateAddress(address);
        if (whole) displayed = address;
        else if (count !== null) displayed = count > 0 ? cutAddress(address, count) : '…';
        return (
            <span {...commonProps}>
                {displayed}
                {measureSpan}
            </span>
        );
    }
    // The accented ends stay six and six; the muted middle carries the rest of
    // what fits, cut at its own middle when the whole value does not.
    let middle = '…';
    if (whole) middle = middleFull;
    else if (count !== null && count > 6) middle = `${address.slice(6, count)}…${address.slice(-count, -6)}`;
    return (
        <span {...commonProps}>
            <span className={styles.head}>{head}</span>
            <span className={styles.middle}>{middle}</span>
            <span className={styles.tail}>{tail}</span>
            {measureSpan}
        </span>
    );
}

function cutAddress(address, count) {
    return `${address.slice(0, count)}…${address.slice(-count)}`;
}

function px(value) {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : 0;
}

function styleOf(el) {
    const view = el?.ownerDocument?.defaultView;
    return view?.getComputedStyle ? view.getComputedStyle(el) : null;
}

function widthOf(el) {
    const width = el?.getBoundingClientRect?.().width;
    return Number.isFinite(width) ? width : 0;
}

// The box whose width is the address's room: the nearest ancestor that lays
// out as a box. An inline parent (a strong, a plain span) has no width of its
// own, so it is looked through.
function roomBox(element) {
    let box = element?.parentElement || null;
    while (box && box.parentElement) {
        // An empty reading (no layout engine) counts as inline.
        const display = styleOf(box)?.display || '';
        if (display !== '' && display !== 'inline' && display !== 'contents') break;
        box = box.parentElement;
    }
    return box;
}

// The address's room is measured with a known form in place (the six-and-six
// form first), so a long value already shown never holds its own box open:
// the reading is the width the layout gives, whatever the address shows now.
// The text is put back before the browser paints.
function withForm(element, highlight, form, read) {
    const holder = highlight ? element.children[1] : element;
    const text = holder?.firstChild;
    if (!text || text.nodeType !== 3) return read();
    const shown = text.data;
    text.data = form;
    try {
        return read();
    } finally {
        text.data = shown;
    }
}

// A box whose width follows its content: an inline-block or inline-flex box,
// or an item of a flex or grid container.
function sizesToContent(box) {
    const display = styleOf(box)?.display || '';
    if (display.startsWith('inline-')) return true;
    const parent = styleOf(box.parentElement)?.display || '';
    return /flex|grid/.test(parent);
}

function overflowsParent(box) {
    const parent = box.parentElement;
    if (!parent) return true;
    return parent.scrollWidth > parent.clientWidth + 1;
}

// The width the address may take in its box: the box's content width less
// what else sits on the address's line. In a row flex box that is the other
// items and the gaps between them; in a grid, the other cells of its row; in
// a block box, the other text and inline boxes on the address's line.
function roomWidth(box, element) {
    const style = styleOf(box);
    const content = box.clientWidth - px(style?.paddingLeft) - px(style?.paddingRight);
    if (!(content > 0)) return 0;
    const own = styleOf(element);
    const chrome = px(own?.paddingLeft) + px(own?.paddingRight)
        + px(own?.borderLeftWidth) + px(own?.borderRightWidth);
    const display = style?.display || '';
    const direction = style?.flexDirection || 'row';
    let item = element;
    while (item.parentElement && item.parentElement !== box) item = item.parentElement;
    let taken = 0;
    if (/flex/.test(display) && direction.startsWith('row')) {
        // In a wrapping row only the items on the address's own line count.
        const wraps = (style.flexWrap || '').startsWith('wrap');
        const mine = element.getBoundingClientRect();
        const others = Array.from(box.children).filter((child) => {
            if (child === item || isOutOfFlow(child)) return false;
            if (!wraps) return true;
            const r = child.getBoundingClientRect();
            return r.top < mine.bottom && r.bottom > mine.top;
        });
        const gap = px(style.columnGap);
        taken = others.reduce((sum, child) => sum + widthOf(child), gap * others.length);
        // The address inside a wrapper item ("Owner: <address>"): the
        // wrapper's other text is taken too.
        if (item !== element) taken += Math.max(0, widthOf(item) - widthOf(element));
    } else if (/grid/.test(display)) {
        const mine = element.getBoundingClientRect();
        const others = Array.from(box.children).filter((child) => {
            if (child === item || isOutOfFlow(child)) return false;
            const r = child.getBoundingClientRect();
            return r.top < mine.bottom && r.bottom > mine.top;
        });
        const gap = px(style.columnGap);
        taken = others.reduce((sum, child) => sum + widthOf(child), gap * others.length);
        if (item !== element) taken += Math.max(0, widthOf(item) - widthOf(element));
    } else {
        taken = lineOthersWidth(box, element, content);
    }
    return content - taken - chrome;
}

function isOutOfFlow(el) {
    const position = styleOf(el)?.position || '';
    return position === 'absolute' || position === 'fixed' || el.hidden;
}

// The width of everything else on the address's line in a block box, from
// the client rects of the box's contents that share the address's line.
function lineOthersWidth(box, element, content) {
    const doc = box.ownerDocument;
    if (typeof doc?.createRange !== 'function') return 0;
    const range = doc.createRange();
    if (typeof range.getClientRects !== 'function') return 0;
    range.selectNodeContents(box);
    const mine = element.getBoundingClientRect();
    if (!(mine.bottom > mine.top)) return 0;
    let left = mine.left;
    let right = mine.right;
    for (const r of Array.from(range.getClientRects())) {
        if (!(r.width > 0) || r.top >= mine.bottom || r.bottom <= mine.top) continue;
        left = Math.min(left, r.left);
        right = Math.max(right, r.right);
    }
    const others = Math.max(0, (right - left) - mine.width);
    // A line already full of wrapping copy gives the address only the room it
    // has now: the address keeps its place in the sentence. A reading with the
    // whole value in place (wider than the box, as in a one-line summary's
    // "Bitcoin, <address>") has no such room to hold, so the text beside it
    // still counts in full or the prefix would be given back to the address.
    if (mine.width > content) return others;
    return Math.min(others, Math.max(0, content - mine.width));
}

// Characters of each end that fit `width`: address.length when the whole
// value fits, else the most that fit around one middle ellipsis.
function fitAddressToWidth(address, width, measure) {
    const measuredWidth = (value) => {
        measure.textContent = value;
        const rectWidth = measure.getBoundingClientRect().width;
        return rectWidth || measure.scrollWidth;
    };

    try {
        if (measuredWidth(address) <= width) return address.length;
        let low = 0;
        let high = Math.floor((address.length - 1) / 2);
        while (low < high) {
            const count = Math.ceil((low + high) / 2);
            if (measuredWidth(cutAddress(address, count)) <= width) low = count;
            else high = count - 1;
        }
        return low;
    } finally {
        measure.textContent = '';
    }
}
