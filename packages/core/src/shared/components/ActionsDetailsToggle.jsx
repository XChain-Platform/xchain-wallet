// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Actions | Details toggle every detail page with more than one action
// shows under its header (ruling 2026-11-13, G102). Actions comes first and
// is chosen by default; it holds the page's ActionList. Details holds the
// facts card, key/value rows and history. Only the chosen panel renders
// (G13), 8px under the toggle (G41, G81).
//
// It is the kit Tabs (framed toggle look, G45) with the standard Actions and
// Details icons (Zap and Info, G13), so keyboard arrows, Home and End move
// between the two and the panel is a tabpanel named by its tab. A page that
// passes `matches` (Order and Swap detail) gets a third tab, Matches with the
// Link icon, after Details. A page that passes `extra` (the oracle record's
// Markets) gets its own named third tab between Actions and Details instead,
// or after Details when the extra tab sets `after` (Dispenser detail's
// Activity, a list tab that follows the facts). A page that must read or set the chosen tab (a filter shown only on one
// tab, an action that jumps to another) passes `view` and `onViewChange`.

import { useCallback, useId, useState } from 'react';
import { Tabs } from '../../ui/Tabs.jsx';
import { InfoIcon, LinkIcon, ZapIcon } from '../../ui/icons/index.jsx';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';
// The Matches tab's word is the Matches section heading's own key.
import '../../i18n/locales/en/mySwaps.js';
import '../../i18n/locales/en/tokenDetail.js';
import styles from './ActionsDetailsToggle.module.css';

const STORAGE_PREFIX = 'xc.actionsDetails.';
/**
 * The tab ids in order: Actions, the page's extra tab, Details, Matches; an
 * extra tab placed `after` comes right after Details instead.
 */
function viewsFor(extraId, hasMatches, extraAfter = false) {
    const extraTab = extraId ? [extraId] : [];
    return [
        'actions',
        ...(extraAfter ? [] : extraTab),
        'details',
        ...(extraAfter ? extraTab : []),
        ...(hasMatches ? ['matches'] : []),
    ];
}

function readStoredView(rememberKey, views) {
    if (!rememberKey) return null;
    try {
        const raw = globalThis.localStorage?.getItem(STORAGE_PREFIX + rememberKey);
        return views.includes(raw) ? raw : null;
    } catch {
        // Private windows and blocked storage throw; fall back to Actions.
        return null;
    }
}

function writeStoredView(rememberKey, view) {
    if (!rememberKey) return;
    try {
        globalThis.localStorage?.setItem(STORAGE_PREFIX + rememberKey, view);
    } catch {
        // Remembering the tab is a convenience; a refusal changes nothing else.
    }
}

/**
 * @param {object} props
 * @param {import('react').ReactNode} props.actions   the Actions panel, normally one ActionList
 * @param {import('react').ReactNode} props.details   the Details panel: facts card, key/value rows, history
 * @param {import('react').ReactNode} [props.matches]  a third Matches panel (Order and Swap detail);
 *   left out, the toggle is Actions and Details only. Only the chosen panel mounts, so a
 *   timeline passed here reads only once Matches is chosen.
 * @param {string} [props.rememberKey]  one key per page kind ('order', 'swap'); when set, the last
 *   chosen tab is remembered on this device. Without it every visit opens on Actions.
 * @param {{ id: string, label: string, icon: import('react').ReactNode, panel: import('react').ReactNode, after?: boolean }} [props.extra]
 *   a page's own third tab, placed between Actions and Details (the oracle record's Markets),
 *   or after Details when `after` is set (Dispenser detail's Activity).
 * @param {string} [props.view]         the chosen tab, when the page owns it; left out, the toggle does
 * @param {(view: string) => void} [props.onViewChange]  told of every pick, owned or not
 * @param {string} [props.rememberKey]  one key per page kind ('order', 'swap'); when set, the last
 *   chosen tab is remembered on this device. Without it every visit opens on Actions.
 * @param {string} [props.label]        the tab row's accessible name
 * @param {string} [props.className]
 */
export function ActionsDetailsToggle({
    actions,
    details,
    matches = null,
    extra = null,
    view: ownedView,
    onViewChange,
    rememberKey,
    label,
    className,
}) {
    const baseId = useId();
    const tabsId = `${baseId}-actions-details`;
    const extraId = extra?.id || null;
    const extraAfter = Boolean(extra?.after);
    const views = viewsFor(extraId, matches != null, extraAfter);
    const [chosen, setView] = useState(() => readStoredView(rememberKey, views) ?? 'actions');
    // A Matches pick outlives a page that later has no Matches panel; show Actions then.
    const wanted = ownedView ?? chosen;
    const view = views.includes(wanted) ? wanted : 'actions';

    const choose = useCallback((next) => {
        if (!viewsFor(extraId, matches != null, extraAfter).includes(next)) return;
        setView(next);
        writeStoredView(rememberKey, next);
        onViewChange?.(next);
    }, [rememberKey, extraId, extraAfter, matches, onViewChange]);

    const panelId = `${tabsId}-panel`;
    const extraItem = extra ? [{ id: extra.id, label: extra.label, icon: extra.icon, controls: panelId }] : [];
    const tabItems = [
        { id: 'actions', label: t('tokenDetail.tabs.actions'), icon: <ZapIcon />, controls: panelId },
        ...(extraAfter ? [] : extraItem),
        { id: 'details', label: t('tokenDetail.tabs.details'), icon: <InfoIcon />, controls: panelId },
        ...(extraAfter ? extraItem : []),
        ...(matches != null
            ? [{ id: 'matches', label: t('mySwaps.detail.matches'), icon: <LinkIcon />, controls: panelId }]
            : []),
    ];
    const panels = { actions, details, matches, ...(extra ? { [extra.id]: extra.panel } : {}) };

    return (
        <div className={[styles.toggle, className].filter(Boolean).join(' ')}>
            <Tabs
                id={tabsId}
                items={tabItems}
                value={view}
                onChange={choose}
                aria-label={label ?? t('components.actionsDetails.sections')}
            />
            <div
                id={panelId}
                role="tabpanel"
                aria-labelledby={`${tabsId}-tab-${view}`}
                data-view={view}
                className={styles.panel}
            >
                {panels[view]}
            </div>
        </div>
    );
}
