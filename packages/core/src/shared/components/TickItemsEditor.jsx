// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@xchain-wallet/core/ui';
import { fetchTokenInfo } from '../hooks/useTokenInfo.js';
import { tickLookupVerdict } from '../utils/listTickItems.js';
import styles from '../routes/IssueTokenForm.module.css';

// Most token lookups one run fires; a longer list reports the rest as
// not checked rather than flooding the explorer.
export const MAX_TICK_LOOKUPS = 50;

/**
 * Token entry block of a TYPE=1 list: the textarea, the parse counts and
 * the per-token existence lookup on the chain the list is published to.
 *
 * The network leaves an unknown TICK out of the list, so the lookup says
 * which ones it could not find before the user pays for them. A `^` TICK_ID
 * reference is not a name the lookup takes, so it stays unchecked.
 *
 * @param {object} props
 * @param {string} props.value                 the raw textarea text
 * @param {(text: string) => void} props.onChange
 * @param {{ valid: string[], invalid: string[], duplicates: number }} props.items   classifyTickItems(value)
 * @param {string | null} props.chainId
 * @param {string} props.chainLabel
 * @param {object | null} props.messaging
 * @param {() => void} props.onOpenPicker
 * @param {Record<string, 'found' | 'missing' | null>} props.status   lookup verdicts, keyed by tick
 * @param {(status: Record<string, 'found' | 'missing' | null>) => void} props.onStatusChange
 */
export function TickItemsEditor({
    value, onChange, items, chainId, chainLabel, messaging, onOpenPicker, status, onStatusChange,
}) {
    const memberTicks = items.valid;
    const invalidTicks = items.invalid;
    const tickKey = memberTicks.join('|');
    const [checking, setChecking] = useState(false);

    useEffect(() => {
        if (!chainId || memberTicks.length === 0) {
            onStatusChange({});
            setChecking(false);
            return undefined;
        }
        let cancelled = false;
        setChecking(true);
        const timer = setTimeout(() => {
            const toCheck = memberTicks.filter((t) => !t.startsWith('^')).slice(0, MAX_TICK_LOOKUPS);
            Promise.all(toCheck.map((t) => fetchTokenInfo(messaging, chainId, t)
                .then((info) => [t, tickLookupVerdict(info)])))
                .then((pairs) => {
                    if (cancelled) return;
                    onStatusChange(Object.fromEntries(pairs));
                    setChecking(false);
                });
        }, 350);
        return () => { cancelled = true; clearTimeout(timer); };
        // tickKey stands in for memberTicks, which is a new array every parse.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chainId, tickKey, messaging]);

    const missingTicks = useMemo(
        () => memberTicks.filter((t) => status[t] === 'missing'),
        [memberTicks, status],
    );
    const foundTicks = useMemo(
        () => memberTicks.filter((t) => status[t] === 'found'),
        [memberTicks, status],
    );
    const uncheckedTickItems = useMemo(
        () => memberTicks.filter((tick) => status[tick] !== 'missing' && status[tick] !== 'found'),
        [memberTicks, status],
    );
    const uncheckedTicks = uncheckedTickItems.length;

    return (
        <>
            <label className={styles.pickerLabel} htmlFor="list-tokens">Tokens (one per line)</label>
            <textarea
                id="list-tokens"
                className={styles.picker}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                rows={6}
                spellCheck={false}
                autoCapitalize="none"
                placeholder="TICK1&#10;TICK2"
            />
            <div className={styles.fromLine}>
                <Button type="button" variant="ghost" onClick={onOpenPicker}>
                    Add from token picker
                </Button>
            </div>
            {value.trim() ? (
                <p className={styles.hint}>
                    {memberTicks.length} valid token name{memberTicks.length === 1 ? '' : 's'}
                    {items.duplicates > 0 ? ` · ${items.duplicates} duplicate${items.duplicates === 1 ? '' : 's'} removed` : ''}
                    {invalidTicks.length > 0 ? ` · ${invalidTicks.length} invalid` : ''}
                    {checking ? ' · checking…' : ''}
                    {!checking && foundTicks.length > 0 ? ` · ${foundTicks.length} found` : ''}
                    {!checking && missingTicks.length > 0 ? ` · ${missingTicks.length} not found` : ''}
                    {!checking && uncheckedTicks > 0 && (foundTicks.length + missingTicks.length) > 0 ? ` · ${uncheckedTicks} not checked` : ''}
                </p>
            ) : null}
            {invalidTicks.length > 0 ? (
                <p className={styles.hint}>Not a token name: {invalidTicks.join(', ')}</p>
            ) : null}
            {/* The protocol records an unknown TICK as invalid and
                leaves it out of the list without failing the LIST. */}
            {!checking && missingTicks.length > 0 ? (
                <div role="alert" className={styles.warnings}>
                    <p className={styles.warning}>
                        Not found on {chainLabel}: {missingTicks.join(', ')}.
                        The network leaves an unknown token out of the list, so {missingTicks.length === 1 ? 'it' : 'they'} will
                        not be a member.
                    </p>
                </div>
            ) : null}
            {!checking && uncheckedTickItems.length > 0 && (foundTicks.length + missingTicks.length) > 0 ? (
                <p className={styles.hint}>Not checked: {uncheckedTickItems.join(', ')}.</p>
            ) : null}
        </>
    );
}
