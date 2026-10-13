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

import { useEffect, useMemo, useState } from 'react';
import { copyText } from '../clipboard.js';
import { logConsole } from '../utils/logConsole.js';
import { redactDiagnosticText } from '../utils/diagnosticText.js';
import { useHapticFeedback } from '../hooks/useHaptic.js';

const ALL_LEVELS = /** @type {const} */ (['log', 'info', 'warn', 'error']);
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
    padding: 'var(--xc-space-2)',
    background: 'var(--xc-bg)',
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-sm)',
    fontFamily: 'var(--xc-font-mono, monospace)',
    fontSize: 'var(--xc-text-xs)',
};

const LIST = {
    maxHeight: 240,
    overflowY: 'auto',
    background: 'var(--xc-bg-muted)',
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-sm)',
    padding: 'var(--xc-space-1)',
};

const ROW = {
    display: 'grid',
    gridTemplateColumns: '52px 64px 1fr',
    gap: 'var(--xc-space-1)',
    padding: '2px 4px',
    borderBottom: '1px solid var(--xc-border)',
};

const LEVEL_COLORS = {
    log: 'var(--xc-text-muted)',
    info: 'var(--xc-text)',
    warn: 'var(--xc-warning, #C28A00)',
    error: 'var(--xc-danger)',
};

const FILTER_CHIP = {
    border: '1px solid var(--xc-border)',
    background: 'transparent',
    color: 'var(--xc-text)',
    borderRadius: 'var(--xc-radius-sm)',
    padding: '2px 8px',
    fontSize: 'var(--xc-text-xs)',
    cursor: 'pointer',
    textTransform: 'capitalize',
};
const FILTER_CHIP_ACTIVE = {
    ...FILTER_CHIP,
    background: 'var(--xc-accent-primary)',
    borderColor: 'var(--xc-accent-primary)',
    color: 'var(--xc-bg)',
};

const ACTION_BTN = {
    background: 'transparent',
    border: '1px solid var(--xc-border)',
    color: 'var(--xc-text)',
    borderRadius: 'var(--xc-radius-sm)',
    padding: '2px 8px',
    fontSize: 'var(--xc-text-xs)',
    cursor: 'pointer',
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

export function LogConsole() {
    const [allEntries, setAllEntries] = useState(() => {
        if (!logConsole.isAttached()) logConsole.attach();
        return logConsole.entries();
    });
    const [enabledLevels, setEnabledLevels] = useState(() => new Set(ALL_LEVELS));
    const [search, setSearch] = useState('');
    const [copyState, setCopyState] = useState(/** @type {'idle' | 'copied' | 'failed'} */ ('idle'));
    const haptic = useHapticFeedback();

    useEffect(() => {
        if (!logConsole.isAttached()) logConsole.attach();
        const unsubscribe = logConsole.subscribe(() => {
            setAllEntries(logConsole.entries());
        });
        return unsubscribe;
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

    const onCopy = async () => {
        const text = safeEntries.map(
            (e) => `${formatTime(e.timestamp)} [${e.level}] ${e.source}: ${e.message}`,
        ).join('\n');
        const { ok } = await copyText(text);
        setCopyState(ok ? 'copied' : 'failed');
        if (ok) haptic.tap();
        else haptic.error();
        setTimeout(() => setCopyState('idle'), 1500);
    };

    return (
        <div style={PANEL}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--xc-space-1)', alignItems: 'center' }}>
                {ALL_LEVELS.map((level) => {
                    const active = enabledLevels.has(level);
                    return (
                        <button
                            key={level}
                            type="button"
                            onClick={() => toggleLevel(level)}
                            aria-pressed={active}
                            style={active ? FILTER_CHIP_ACTIVE : FILTER_CHIP}
                        >
                            {level}
                        </button>
                    );
                })}
                <input
                    type="search"
                    enterKeyHint="search"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search messages…"
                    aria-label="Search log messages"
                    style={{
                        flex: 1,
                        minWidth: 120,
                        background: 'var(--xc-bg-muted)',
                        color: 'var(--xc-text)',
                        border: '1px solid var(--xc-border)',
                        borderRadius: 'var(--xc-radius-sm)',
                        padding: '2px 6px',
                        fontSize: 'var(--xc-text-xs)',
                    }}
                />
                <button
                    type="button"
                    onClick={onCopy}
                    style={ACTION_BTN}
                    aria-label="Copy all log entries"
                    title="Copy filtered log entries plus entries hidden by the active filters"
                >
                    {copyState === 'copied'
                        ? 'Copied'
                        : copyState === 'failed'
                            ? 'Copy failed: clipboard unavailable'
                            : 'Copy all'}
                </button>
                <button type="button" onClick={onClear} style={ACTION_BTN} aria-label="Clear log buffer">
                    Clear
                </button>
            </div>
            <div style={LIST} role="log" aria-label="Recent console entries" aria-live="polite">
                {copyState !== 'idle' ? (
                    <span style={SR_ONLY}>
                        {copyState === 'copied' ? 'Copied' : 'Copy failed: clipboard unavailable'}
                    </span>
                ) : null}
                {filtered.length === 0 ? (
                    <div style={{ color: 'var(--xc-text-muted)', padding: 'var(--xc-space-2)' }}>
                        No log entries yet. Trigger an action and recent console output will appear here.
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
                Showing {visible.length} of {filtered.length} matching entries ({allEntries.length} total).
            </div>
        </div>
    );
}
