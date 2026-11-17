// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The one action list (ruling 2026-11-13, G101): every set of actions a page
// offers is one wide list card, a row per action with a bare icon (no
// tile), a title, a one-line description and the trailing chevron. It
// replaces short round or pill action buttons and the square action tiles.
//
// A row is the kit ListRow, the same row Settings draws its group list with,
// so an action row and a Settings row share one look, hover, focus and
// chevron; this file adds only the bare icon and the disabled-with-a-reason
// state. The tone prop is still accepted (and stamped as data-tone) but draws
// nothing: a Delete or Remove row is never red (ruling 2026-11-14).

import { useId } from 'react';
import { ListRow } from '../../ui/ListRow.jsx';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/tokenDetail.js';
import styles from './ActionList.module.css';

/**
 * @typedef {object} ActionListItemProps
 * @property {import('react').ReactNode} icon          the glyph drawn bare, 36px, in accent text
 * @property {string} [iconLabel]                     exposes a stateful icon to assistive technology
 * @property {import('react').ReactNode} title         the action's name, sentence case (G01)
 * @property {import('react').ReactNode} [description] one line under the title saying what it does
 * @property {(event: import('react').MouseEvent) => void} [onClick]
 * @property {string} [href]                          an anchor row; onClick still runs on it
 * @property {'default' | 'danger'} [tone]            accepted so callers do not break; it no longer changes the look (ruling 2026-11-14: every action row is one colour, a Delete row included)
 * @property {boolean} [disabled]                     the row stays focusable and announces itself dimmed
 * @property {import('react').ReactNode} [disabledReason] why it is off; shown in place of the description
 * @property {boolean} [chevron]                      defaults to true: the row goes somewhere (G97)
 */

/**
 * One action row. Rendered inside an ActionList, it is one list item.
 *
 * A disabled row is not a native disabled button: it keeps its place in the
 * tab order so a keyboard or screen-reader user reaches it and hears why it
 * is off (aria-disabled plus aria-describedby on the reason), and a press
 * does nothing. An href row has no disabled state of its own, so a disabled
 * href row drops the link and renders as the same inert button.
 *
 * @param {ActionListItemProps & Record<string, unknown>} props
 */
export function ActionListItem({
    icon,
    iconLabel,
    title,
    description,
    onClick,
    href,
    tone = 'default',
    disabled = false,
    disabledReason,
    chevron = true,
    ...rest
}) {
    const reasonId = useId();
    const danger = tone === 'danger';
    const subtitle = disabled && disabledReason ? (
        <span id={reasonId} className={styles.reason}>{disabledReason}</span>
    ) : description;

    const rowProps = disabled
        ? {
            onClick: (event) => { event.preventDefault(); },
            'aria-disabled': 'true',
            'aria-describedby': disabledReason ? reasonId : undefined,
        }
        : { href, onClick };

    return (
        <li className={styles.item}>
            <ListRow
                {...rest}
                {...rowProps}
                className={styles.row}
                data-tone={danger ? 'danger' : 'default'}
                leading={(
                    <span
                        className={styles.iconTile}
                        data-tone={danger ? 'danger' : 'default'}
                        role={iconLabel ? 'img' : undefined}
                        aria-label={iconLabel || undefined}
                        aria-hidden={iconLabel ? undefined : 'true'}
                    >
                        {icon}
                    </span>
                )}
                title={<span className={styles.titleText} data-tone={danger ? 'danger' : 'default'}>{title}</span>}
                subtitle={subtitle}
                chevron={chevron && !disabled}
            />
        </li>
    );
}

/**
 * The list card that holds action rows: a native list (ul and li) in one
 * flush card with divider lines, named for assistive tech.
 *
 * Pass rows as ActionListItem children, or as `items` (each an
 * ActionListItem's props plus an `id`).
 *
 * @param {object} props
 * @param {string} [props.label]   the list's accessible name; defaults to "Actions"
 * @param {Array<ActionListItemProps & { id: string }>} [props.items]
 * @param {import('react').ReactNode} [props.children]
 * @param {string} [props.className]
 */
export function ActionList({ label, items, children, className, ...rest }) {
    return (
        /* Safari needs an explicit list role because this class removes list styling. */
        <ul
            {...rest}
            role="list"
            aria-label={label ?? t('tokenDetail.tabs.actions')}
            className={[styles.list, className].filter(Boolean).join(' ')}
        >
            {items ? items.map(({ id, ...item }) => <ActionListItem key={id} {...item} />) : children}
        </ul>
    );
}
