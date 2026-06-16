// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Skeleton — §37.1 / G118. Content-shaped placeholder with a subtle
// shimmer; collapses to a static gray block under
// `prefers-reduced-motion` (CSS handles that automatically).
//
// Usage:
//
//   <Skeleton shape="text" width={120} />
//   <Skeleton shape="title" />
//   <Skeleton shape="card" />
//
//   <Skeleton.Row />              // avatar + two text lines
//   <Skeleton.List rows={5} />    // five stacked rows — drop-in for a
//                                 // not-yet-loaded list
//
// `aria-hidden="true"` is set by default so screen-readers skip the
// placeholders. When the loading state is itself important to announce,
// pair the skeleton with a `role="status"` `aria-live` element somewhere
// in the parent.

import styles from './Skeleton.module.css';

const SHAPE_CLASS = {
    row: styles.shapeRow,
    text: styles.shapeText,
    title: styles.shapeTitle,
    avatar: styles.shapeAvatar,
    badge: styles.shapeBadge,
    card: styles.shapeCard,
    tile: styles.shapeTile,
};

/**
 * @param {object} props
 * @param {'row' | 'text' | 'title' | 'avatar' | 'badge' | 'card' | 'tile'} [props.shape]   default 'row'
 * @param {number | string} [props.width]              fixed width override (e.g. 120 or '8em')
 * @param {number | string} [props.height]             fixed height override
 * @param {string} [props.className]                   extra class for ad-hoc layout tweaks
 * @param {import('react').CSSProperties} [props.style]
 * @param {string} [props.ariaLabel]                   if supplied, the element is exposed to assistive tech with this label (and aria-hidden is dropped)
 */
export function Skeleton({
    shape = 'row',
    width,
    height,
    className,
    style,
    ariaLabel,
}) {
    const inlineStyle = { ...style };
    if (width !== undefined) inlineStyle.width = typeof width === 'number' ? `${width}px` : width;
    if (height !== undefined) inlineStyle.height = typeof height === 'number' ? `${height}px` : height;
    const classes = [
        styles.skeleton,
        SHAPE_CLASS[shape] || SHAPE_CLASS.row,
        className,
    ].filter(Boolean).join(' ');
    return ariaLabel
        ? (
            <span
                className={classes}
                style={inlineStyle}
                role="status"
                aria-label={ariaLabel}
            />
        )
        : (
            <span
                className={classes}
                style={inlineStyle}
                aria-hidden="true"
            />
        );
}

/**
 * One placeholder row matching the wallet's typical avatar + title +
 * subtitle layout (balance row, history row, address row).
 *
 * @param {object} [props]
 * @param {boolean} [props.avatar]   default true
 * @param {string} [props.titleWidth]  e.g. '60%'
 * @param {string} [props.subtitleWidth] e.g. '40%'
 */
function SkeletonRow({ avatar = true, titleWidth = '60%', subtitleWidth = '40%' } = {}) {
    return (
        <div className={styles.row} aria-hidden="true">
            {avatar ? <Skeleton shape="avatar" /> : null}
            <span className={styles.rowText}>
                <Skeleton shape="title" width={titleWidth} />
                <Skeleton shape="text" width={subtitleWidth} />
            </span>
        </div>
    );
}

/**
 * Stack of N placeholder rows — drop-in for a not-yet-loaded list.
 *
 * @param {object} props
 * @param {number} props.rows
 * @param {boolean} [props.avatar]
 */
function SkeletonList({ rows, avatar = true }) {
    const count = Math.max(0, Math.floor(rows));
    return (
        <div className={styles.list} aria-hidden="true">
            {Array.from({ length: count }, (_, i) => (
                <SkeletonRow key={i} avatar={avatar} />
            ))}
        </div>
    );
}

Skeleton.Row = SkeletonRow;
Skeleton.List = SkeletonList;
