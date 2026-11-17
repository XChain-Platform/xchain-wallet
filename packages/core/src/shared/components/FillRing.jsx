// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The fill ring (operator 2026-11-13, wallet-orders-layout-1-ring): how much
// of an order or swap has filled, drawn as a conic ring with the share in its
// centre. My Orders and My Swaps rows show the small ring in place of a status
// chip, with the status word under it; the Order and Swap detail headers show
// the large one. A filled order shows a tick and a cancelled one a cross in
// place of the share. A swap is single-fill, so its ring is 0% or 100%.
//
// The ring holds no words of its own: the caller passes the status word and
// the accessible name, so the list and the detail word them the same way.

import { CheckIcon, ClockIcon, XIcon } from '../../ui/icons/index.jsx';
import styles from './FillRing.module.css';

const TONES = new Set(['accent', 'warning', 'success', 'danger', 'muted']);

/**
 * @param {object} props
 * @param {number | null} [props.percent]   0 to 100, or null when the share is unknown
 * @param {'accent' | 'warning' | 'success' | 'danger' | 'muted'} [props.tone]  open, partly filled, filled, urgent, closed
 * @param {'tick' | 'cross' | 'clock' | null} [props.mark]   drawn in the centre in place of the share;
 *        clock is the Payments due ring, whose arc is the payment window left
 *        and whose caption is the time left in plain case ("24m")
 * @param {'sm' | 'lg'} [props.size]        sm on a list row (about 38px), lg on a detail header (about 68px)
 * @param {import('react').ReactNode} [props.caption]  the status word under the ring, in small caps
 * @param {string} [props.label]            the ring's accessible name ("62% filled"); without it the ring is decoration
 * @param {string} [props.status]           the display status, exposed as data-status for styling and tests
 * @param {string} [props.className]
 * @param {boolean} [props.fitCaption]  the status column takes the word's natural width, never clipping it (My orders)
 */
export function FillRing({
    percent = null,
    tone = 'accent',
    mark = null,
    size = 'sm',
    caption = null,
    label,
    status,
    className,
    fitCaption = false,
}) {
    const known = typeof percent === 'number' && Number.isFinite(percent);
    const share = known ? Math.min(100, Math.max(0, Math.round(percent))) : 0;
    const ringTone = TONES.has(tone) ? tone : 'accent';
    let centre = known ? `${share}%` : '-';
    if (mark === 'tick') centre = <CheckIcon />;
    else if (mark === 'cross') centre = <XIcon />;
    else if (mark === 'clock') centre = <ClockIcon />;
    const named = typeof label === 'string' && label.length > 0;
    return (
        <span
            className={[styles.fillRing, className].filter(Boolean).join(' ')}
            data-fill-ring
            data-size={size === 'lg' ? 'lg' : 'sm'}
            data-column={size === 'lg' ? undefined : (fitCaption ? 'fit' : 'status')}
            data-tone={ringTone}
            data-mark={mark || undefined}
            data-status={status || undefined}
            data-percent={known ? String(share) : undefined}
        >
            <span
                className={styles.ring}
                style={{ '--fill-ring-share': `${share}%` }}
                {...(named ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' })}
            >
                <span className={styles.hole} aria-hidden="true">{centre}</span>
            </span>
            {caption ? <span className={styles.caption}>{caption}</span> : null}
        </span>
    );
}
