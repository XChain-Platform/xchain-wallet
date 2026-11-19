// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The bet market's Bet tab list (operator ruling 2026-11-13): one rounded
// list card with every outcome as a row, divider lines between them. A row
// leads with the outcome's mark (a thumb for Yes or No, otherwise its letter,
// on its own colour), then its name and amount staked, its chance in bold and
// a chevron; a faint fill behind the row is the outcome's share of the pool.
// The whole row is one button that opens Place Bet for that outcome. The
// governance poll's Vote tab draws its choices with the same list (operator
// ruling 2026-11-13), a row opening Cast Vote for that choice; an open poll
// has no tally yet, so its rows pass no amount, chance or share and draw
// none. Built on the kit ListRow, so it reads like the wallet's other action
// lists. Every word on screen comes in as a prop from the page.

import { Icon, ListRow } from '@xchain-wallet/core/ui';
import styles from './OutcomeList.module.css';

/** How many distinct hues the palette holds (--xc-outcome-1 to -8). */
const PALETTE_SIZE = 8;

/**
 * The mark of outcome `index` in a market whose labels are `labels`: Yes and
 * No (by their labels, whatever their place) take a thumb on their meaning
 * colour; any other outcome takes its letter (A for the first outcome, B for
 * the second) on the palette hue of its place. An index the market does not
 * list reads as unknown.
 *
 * @param {string[]} labels
 * @param {number | string} index
 * @returns {{ tone: 'yes' | 'no' | 'unknown' | number, letter: string }}
 */
export function outcomeMarkOf(labels, index) {
    const i = Number(index);
    if (!Array.isArray(labels) || !Number.isInteger(i) || i < 0 || i >= labels.length) {
        return { tone: 'unknown', letter: '?' };
    }
    const label = String(labels[i] ?? '').trim();
    if (/^yes$/i.test(label)) return { tone: 'yes', letter: '' };
    if (/^no$/i.test(label)) return { tone: 'no', letter: '' };
    // BET allows at most 16 outcomes, so the letters never run past P.
    return { tone: i % PALETTE_SIZE, letter: i < 26 ? String.fromCharCode(65 + i) : String(i + 1) };
}

/** The data-outcome-tone value the stylesheet colours by. */
function toneKey(tone) {
    return typeof tone === 'number' ? `p${tone}` : tone;
}

/**
 * An outcome's mark: a white thumb or letter on the outcome's colour, a
 * rounded square in the Bet list and a circle in Activity. Decorative; the
 * row around it names the outcome.
 *
 * @param {object} props
 * @param {'yes' | 'no' | 'unknown' | number} props.tone
 * @param {string} [props.letter]
 * @param {'square' | 'round'} [props.shape]
 */
export function OutcomeMark({ tone, letter = '', shape = 'square' }) {
    let glyph = <span className={styles.markLetter}>{letter}</span>;
    if (tone === 'yes') glyph = <Icon.ThumbsUpIcon />;
    else if (tone === 'no') glyph = <Icon.ThumbsDownIcon />;
    return (
        <span
            className={`${styles.mark} ${shape === 'round' ? styles.markRound : ''}`}
            data-outcome-tone={toneKey(tone)}
            data-outcome-mark={tone === 'yes' ? 'thumbs-up' : tone === 'no' ? 'thumbs-down' : letter}
            aria-hidden="true"
        >
            {glyph}
        </span>
    );
}

/**
 * The outcome list.
 *
 * @param {object} props
 * @param {string} props.label    the list's accessible name
 * @param {Array<{
 *   key: number,
 *   label: string,
 *   mark: { tone: 'yes' | 'no' | 'unknown' | number, letter: string },
 *   staked?: string | null,
 *   chance?: string | null,
 *   percent?: number | null,
 *   name: string,
 *   disabled?: boolean,
 *   onSelect: () => void,
 * }>} [props.options]   one per outcome, in the market's order; `name` is the
 *   row's accessible name, `staked` the line under the name (the amount
 *   staked, or none), `percent` the unrounded share the fill is drawn at
 */
export function OutcomeList({ label, options = [], ...rest }) {
    if (!Array.isArray(options) || options.length === 0) return null;
    return (
        /* Safari needs an explicit list role because this class removes list styling. */
        <ul {...rest} role="list" aria-label={label} className={styles.list} data-outcome-list="">
            {options.map((option) => {
                const fill = typeof option.percent === 'number' && Number.isFinite(option.percent)
                    ? Math.max(0, Math.min(100, option.percent))
                    : 0;
                return (
                    <li key={option.key} className={styles.item} data-outcome-tone={toneKey(option.mark.tone)}>
                        <span className={styles.fill} style={{ width: `${fill}%` }} data-outcome-fill={fill} aria-hidden="true" />
                        <ListRow
                            className={styles.row}
                            contentClassName={styles.content}
                            trailingClassName={styles.chance}
                            leading={<OutcomeMark tone={option.mark.tone} letter={option.mark.letter} />}
                            title={option.label}
                            subtitle={option.staked}
                            trailing={option.chance || null}
                            chevron
                            aria-label={option.name}
                            disabled={option.disabled}
                            onClick={option.onSelect}
                            data-outcome-option={option.key}
                        />
                    </li>
                );
            })}
        </ul>
    );
}
