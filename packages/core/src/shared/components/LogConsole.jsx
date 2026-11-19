// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// LogConsole: §48.5 / G150 Developer-Mode log viewer. Renders the
// process-wide `logConsole` ring buffer in a scrollable, filterable
// panel. Mounts inside Settings → Developer Mode (keeps the change
// scoped to one Settings surface; doesn't require touching all three
// shell App.jsx files for a global drawer).
//
// On mount the component idempotently calls `logConsole.attach()` so
// any subsequent `console.log/info/warn/error` flows into the buffer.
// Already-attached state is preserved across mounts; a sister page
// that opens later sees the full session backlog. The component never
// detaches; leaving it attached for the rest of the session is
// cheaper than re-arming on every Developer Mode visit.
//
// The page that hosts it (Developer options > Logs and diagnostics console)
// keeps the level toggles, Copy all and Clear in its title-bar filter panel
// with the search (G04, operator walk 2026-11-15): useLogConsole holds the
// state, LogConsoleControls draws the panel's part and LogConsole the list.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Chip, Icon } from '@xchain-wallet/core/ui';
import { copyText } from '../clipboard.js';
import { logConsole } from '../utils/logConsole.js';
import { redactDiagnosticText } from '../utils/diagnosticText.js';
import { useHapticFeedback } from '../hooks/useHaptic.js';
import { formatDecimalAmount } from '../utils/amountFormat.js';
import { titleCase } from '../utils/titleCase.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';
import '../../i18n/locales/en/history.js';
import styles from './LogConsole.module.css';

export const ALL_LEVELS = /** @type {const} */ (['log', 'info', 'warn', 'error']);

// The console text is monospace at the small size, one step above the
// extra-small it used to be (operator walk 2026-11-15: too small to read).
export const LOG_TEXT_SIZE = 'var(--xc-text-sm)';
const MAX_VISIBLE_ENTRIES = 200;
const SAFE_ENTRY_CACHE = new WeakMap();

function safeEntry(entry) {
    if (!entry || typeof entry !== 'object') return entry;
    const cached = SAFE_ENTRY_CACHE.get(entry);
    if (cached) return cached;
    const safe = {
        ...entry,
        source: redactDiagnosticText(entry.source),
        message: redactDiagnosticText(entry.message),
    };
    SAFE_ENTRY_CACHE.set(entry, safe);
    return safe;
}

const PANEL = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--xc-space-2)',
    padding: 'var(--xc-card-pad)',
    background: 'var(--xc-card-bg)',
    border: 'var(--xc-card-border)',
    borderRadius: 'var(--xc-card-radius)',
    fontFamily: 'var(--xc-font-mono, monospace)',
    fontSize: LOG_TEXT_SIZE,
};

const LIST = {
    maxHeight: 240,
    overflowY: 'auto',
};

// The time (HH:MM:SS) and level ("error" at most) columns are sized in
// characters of the monospace face, so they fit at any text size.
const ROW = {
    display: 'grid',
    gridTemplateColumns: '8ch 5ch minmax(0, 1fr)',
    gap: 'var(--xc-space-1)',
    padding: '2px 4px',
    borderBottom: '1px solid var(--xc-border)',
};

const LEVEL_COLORS = {
    log: 'var(--xc-text-muted)',
    info: 'var(--xc-text)',
    warn: 'var(--xc-warning, #C28A00)',
    error: 'var(--xc-danger-fg)',
};

const SR_ONLY = {
    position: 'absolute',
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    border: 0,
};

function formatTime(ms) {
    const d = new Date(ms);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
}

/**
 * The console's state: the buffer, the level and search filters, and the
 * Copy all and Clear actions. Mounting it attaches the process-wide buffer.
 */
export function useLogConsole() {
    const [allEntries, setAllEntries] = useState(() => logConsole.entries());
    const [enabledLevels, setEnabledLevels] = useState(() => new Set(ALL_LEVELS));
    const [search, setSearch] = useState('');
    const [copyState, setCopyState] = useState(/** @type {'idle' | 'copied' | 'failed'} */ ('idle'));
    const copyAttemptRef = useRef(0);
    const copyResetTimerRef = useRef(null);
    const haptic = useHapticFeedback();

    useEffect(() => {
        if (!logConsole.isAttached()) logConsole.attach();
        const unsubscribe = logConsole.subscribe(() => {
            setAllEntries(logConsole.entries());
        });
        setAllEntries(logConsole.entries());
        return () => {
            unsubscribe();
            copyAttemptRef.current += 1;
            if (copyResetTimerRef.current !== null) {
                clearTimeout(copyResetTimerRef.current);
                copyResetTimerRef.current = null;
            }
        };
    }, []);

    const safeEntries = useMemo(() => allEntries.map(safeEntry), [allEntries]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return safeEntries.filter((e) => {
            if (!enabledLevels.has(e.level)) return false;
            if (!q) return true;
            return (
                e.message.toLowerCase().includes(q)
                || e.source.toLowerCase().includes(q)
            );
        });
    }, [enabledLevels, safeEntries, search]);
    const visible = filtered.slice(-MAX_VISIBLE_ENTRIES);

    const toggleLevel = (level) => {
        setEnabledLevels((prev) => {
            const next = new Set(prev);
            if (next.has(level)) next.delete(level);
            else next.add(level);
            return next;
        });
    };

    const onClear = () => {
        logConsole.clear();
        setAllEntries([]);
    };

    const onCopy = () => {
        const attempt = copyAttemptRef.current + 1;
        copyAttemptRef.current = attempt;
        if (copyResetTimerRef.current !== null) {
            clearTimeout(copyResetTimerRef.current);
            copyResetTimerRef.current = null;
        }
        const text = safeEntries.map(
            (e) => `${formatTime(e.timestamp)} [${e.level}] ${e.source}: ${e.message}`,
        ).join('\n');
        void (async () => {
            let ok = false;
            try {
                const result = await copyText(text);
                ok = Boolean(result?.ok);
            } catch {
                ok = false;
            }
            if (copyAttemptRef.current !== attempt) return;
            setCopyState(ok ? 'copied' : 'failed');
            if (ok) haptic.tap();
            else haptic.error();
            copyResetTimerRef.current = setTimeout(() => {
                if (copyAttemptRef.current === attempt) setCopyState('idle');
                copyResetTimerRef.current = null;
            }, 1500);
        })();
    };

    return {
        allEntries,
        filtered,
        visible,
        enabledLevels,
        toggleLevel,
        search,
        setSearch,
        // A level turned off narrows the list, so the filter button shows it.
        levelsNarrowed: enabledLevels.size !== ALL_LEVELS.length,
        copyState,
        onCopy,
        onClear,
    };
}

/** A level's name as its toggle shows it ("Warn"). */
const levelLabel = (level) => level.charAt(0).toUpperCase() + level.slice(1);

/**
 * The console's own filter-panel content, under the panel's search box: one
 * toggle per level (any mix on), then Copy all and Clear.
 *
 * @param {{ state: ReturnType<typeof useLogConsole> }} props
 */
export function LogConsoleControls({ state }) {
    const { enabledLevels, toggleLevel, copyState, onCopy, onClear } = state;
    return (
        <div className={styles.controls} data-log-console-controls="">
            <div className={styles.levels}>
                {ALL_LEVELS.map((level) => (
                    <Chip
                        key={level}
                        pressed={enabledLevels.has(level)}
                        onPressedChange={() => toggleLevel(level)}
                        data-log-level={level}
                    >
                        {levelLabel(level)}
                    </Chip>
                ))}
            </div>
            <div className={styles.actions}>
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    icon={<Icon.CopyIcon />}
                    onClick={onCopy}
                    aria-label={t('components.logConsole.copyAllLogEntries')}
                    title={t('components.logConsole.copyFilteredLogEntriesPlus')}
                >
                    {/* A kit button's label is Title Case (G01), its copy states included. */}
                    {titleCase(copyState === 'copied'
                        ? t('history.copy.copied')
                        : copyState === 'failed'
                            ? t('components.logConsole.copyFailedClipboardUnavailable')
                            : t('components.logConsole.copyAll'))}
                </Button>
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    icon={<Icon.TrashIcon />}
                    onClick={onClear}
                    aria-label={t('components.logConsole.clearLogBuffer')}
                >
                    {/* In a filter panel a bare "Clear" reads as clearing the
                        filters; this one empties the log buffer. */}
                    {titleCase(t('components.logConsole.clearLogBuffer'))}
                </Button>
            </div>
        </div>
    );
}

/**
 * The console messages list. Pass the page's useLogConsole state so the
 * filters in its title bar narrow it; without one it reads the buffer itself
 * with every level shown.
 *
 * @param {{ state?: ReturnType<typeof useLogConsole> }} [props]
 */
export function LogConsole({ state } = {}) {
    return state ? <LogConsoleList state={state} /> : <OwnLogConsole />;
}

function OwnLogConsole() {
    return <LogConsoleList state={useLogConsole()} />;
}

function LogConsoleList({ state }) {
    const { allEntries, filtered, visible, copyState } = state;
    return (
        <div style={PANEL} data-log-console-list="">
            <div style={LIST} role="log" aria-label={t('components.logConsole.recentConsoleEntries')} aria-live="polite">
                {copyState !== 'idle' ? (
                    <span style={SR_ONLY}>
                        {copyState === 'copied' ? t('history.copy.copied') : t('components.logConsole.copyFailedClipboardUnavailable')}
                    </span>
                ) : null}
                {filtered.length === 0 ? (
                    <div style={{ color: 'var(--xc-text-muted)', padding: 'var(--xc-space-2)' }}>
                        {t('components.logConsole.noLogEntriesYetTrigger')}
                    </div>
                ) : (
                    visible.map((e) => (
                        <div key={e.id} style={ROW}>
                            <span style={{ color: 'var(--xc-text-muted)' }}>{formatTime(e.timestamp)}</span>
                            <span style={{ color: LEVEL_COLORS[e.level] || 'var(--xc-text)', fontWeight: 600 }}>
                                {e.level}
                            </span>
                            <span style={{ color: 'var(--xc-text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                <span style={{ color: 'var(--xc-text-muted)' }}>{e.source}: </span>
                                {e.message}
                            </span>
                        </div>
                    ))
                )}
            </div>
            <div style={{ color: 'var(--xc-text-muted)', fontSize: 'var(--xc-text-xs)' }}>
                {t('components.logConsole.showing')} {formatDecimalAmount(visible.length)} {t('components.logConsole.of')} {formatDecimalAmount(filtered.length)} {t('components.logConsole.matchingEntries')}{' '}
                ({formatDecimalAmount(allEntries.length)} {t('components.logConsole.total')}
            </div>
        </div>
    );
}
