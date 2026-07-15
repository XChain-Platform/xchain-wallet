// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// KeyboardSection: §34.1 shortcut rebinding.
//
// Lists every shortcut from the keyboard catalogue grouped as in the help
// modal. Rebindable entries (the globally-dispatched set + the palette
// combo) get a "Rebind" affordance: click, press the new key(s), done.
// Capture keeps each shortcut in its original binding family - a modifier
// combo records Cmd/Ctrl+key, a single key records one key, a leader
// sequence records two keys in succession - so the dispatcher's focus rules
// stay coherent. Overrides persist in settings.keyboard.bindings and apply
// live (the App shells thread them into useKeyboardShortcuts /
// useCommandPalette / ShortcutHelp). Context shortcuts (§34.2) render
// read-only: they dispatch inside their route, not from the settings table.

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@xchain-wallet/core/ui';
import { useSettings } from '../../hooks/useSettings.js';
import {
    SHORTCUTS,
    SHORTCUT_GROUPS,
    findBindingConflict,
    formatBinding,
    isRebindable,
    isValidBinding,
    parseBinding,
    resolveBindings,
} from '../../keyboard/shortcuts.js';
import { ROW, ROW_LABEL, STACK, Status } from './_settingsPrimitives.jsx';

const GROUP_HEADER = {
    fontSize: 'var(--xc-text-sm)',
    fontWeight: 600,
    color: 'var(--xc-text)',
    marginTop: 'var(--xc-space-3)',
    marginBottom: 'var(--xc-space-1)',
};
const KBD = {
    fontFamily: 'var(--xc-font-sans)',
    fontSize: 'var(--xc-text-xs)',
    color: 'var(--xc-text)',
    background: 'var(--xc-bg-muted)',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--xc-border)',
    borderRadius: 'var(--xc-radius-sm)',
    padding: '2px 7px',
    whiteSpace: 'nowrap',
};
const CAPTURING = {
    ...KBD,
    borderColor: 'var(--xc-accent)',
    color: 'var(--xc-accent)',
};
const ACTIONS = { display: 'flex', alignItems: 'center', gap: 'var(--xc-space-2)', flexShrink: 0 };

function isMac() {
    if (typeof navigator === 'undefined') return false;
    return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent || '');
}

/**
 * Translate a captured keydown into a binding fragment, or null when the
 * event is a bare modifier / unusable key.
 * @param {KeyboardEvent} e
 * @param {'combo' | 'single' | 'leader'} kind
 */
function bindingFromEvent(e, kind) {
    const key = (e.key || '').toLowerCase();
    if (['shift', 'control', 'meta', 'alt'].includes(key)) return null;
    if (kind === 'combo') {
        if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return null;
        const named = { enter: 'enter', escape: 'escape', backspace: 'backspace', tab: 'tab', ' ': 'space' };
        return `mod+${named[key] || key}`;
    }
    // single / leader fragments: one printable key, no modifiers. '?' needs
    // shift on most layouts, so only block ctrl/meta/alt here.
    if (e.metaKey || e.ctrlKey || e.altKey) return null;
    const k = kind === 'single' ? e.key : key;
    return k.length === 1 ? k : null;
}

export function KeyboardSection() {
    const { settings, update, loading, error } = useSettings();
    const overrides = settings?.keyboard?.bindings || {};
    const shortcuts = useMemo(() => resolveBindings(overrides), [overrides]);
    const mac = isMac();

    // id of the shortcut being rebound, plus the captured leader lead key
    // while waiting for the sequence's second key.
    const [capturingId, setCapturingId] = useState(/** @type {string | null} */ (null));
    const [leaderLead, setLeaderLead] = useState(/** @type {string | null} */ (null));
    const [status, setStatus] = useState(/** @type {{ kind: 'ok' | 'error', text: string } | null} */ (null));

    useEffect(() => {
        if (!capturingId || typeof window === 'undefined') return undefined;
        const target = shortcuts.find((s) => s.id === capturingId);
        if (!target) { setCapturingId(null); return undefined; }
        // Rebinding keeps the DEFAULT binding's family even when an override
        // is active, so a combo can't drift into a leader sequence.
        const defaultBinding = SHORTCUTS.find((s) => s.id === capturingId)?.binding || target.binding;
        const kind = parseBinding(defaultBinding).kind;

        const commit = (binding) => {
            setCapturingId(null);
            setLeaderLead(null);
            if (!isValidBinding(binding, kind)) {
                setStatus({ kind: 'error', text: `"${binding}" isn't a usable ${kind} binding.` });
                return;
            }
            const conflict = findBindingConflict(capturingId, binding, overrides);
            if (conflict) {
                const other = shortcuts.find((s) => s.id === conflict);
                setStatus({ kind: 'error', text: `${formatBinding(binding, mac)} is already used by "${other?.label || conflict}".` });
                return;
            }
            const next = { ...overrides, [capturingId]: binding };
            update({ keyboard: { bindings: next } })
                .then(() => setStatus({ kind: 'ok', text: `${target.label} is now ${formatBinding(binding, mac)}.` }))
                .catch((err) => setStatus({ kind: 'error', text: err?.message || 'Failed to save the binding.' }));
        };

        const onKey = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.key === 'Escape' && kind !== 'combo') { setCapturingId(null); setLeaderLead(null); return; }
            const frag = bindingFromEvent(e, kind);
            if (frag === null) return;
            if (kind === 'leader') {
                if (!leaderLead) { setLeaderLead(frag); return; }
                commit(`${leaderLead} ${frag}`);
                return;
            }
            commit(frag);
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [capturingId, leaderLead, overrides, shortcuts, update, mac]);

    const resetOne = (id) => {
        const next = { ...overrides };
        delete next[id];
        update({ keyboard: { bindings: next } })
            .then(() => setStatus({ kind: 'ok', text: 'Shortcut reset to its default.' }))
            .catch((err) => setStatus({ kind: 'error', text: err?.message || 'Failed to reset.' }));
    };

    if (loading) return <p style={ROW_LABEL}>Loading…</p>;
    if (error) return <p role="alert" style={ROW_LABEL}>{error.message || 'Failed to load settings.'}</p>;

    return (
        <div style={STACK}>
            <p style={{ ...ROW_LABEL, color: 'var(--xc-text-muted)' }}>
                Click Rebind, then press the new key combination. Screen-specific
                shortcuts are fixed and only work on their screen.
            </p>
            {status ? <Status text={status.text} tone={status.kind === 'error' ? 'error' : 'muted'} /> : null}
            {SHORTCUT_GROUPS.map((group) => (
                <section key={group}>
                    <h3 style={GROUP_HEADER}>{group}</h3>
                    {shortcuts.filter((s) => s.group === group).map((s) => {
                        const capturing = capturingId === s.id;
                        return (
                            <div key={s.id} style={ROW}>
                                <span style={ROW_LABEL}>{s.label}</span>
                                <span style={ACTIONS}>
                                    <kbd style={capturing ? CAPTURING : KBD} aria-live={capturing ? 'polite' : undefined}>
                                        {capturing
                                            ? (leaderLead ? `${leaderLead.toUpperCase()} then …` : 'Press keys…')
                                            : formatBinding(s.binding, mac)}
                                    </kbd>
                                    {isRebindable(s) ? (
                                        <>
                                            <Button
                                                size="sm"
                                                variant="secondary"
                                                onClick={() => {
                                                    setStatus(null);
                                                    setLeaderLead(null);
                                                    setCapturingId(capturing ? null : s.id);
                                                }}
                                            >
                                                {capturing ? 'Cancel' : 'Rebind'}
                                            </Button>
                                            {s.overridden ? (
                                                <Button size="sm" variant="ghost" onClick={() => resetOne(s.id)}>
                                                    Reset
                                                </Button>
                                            ) : null}
                                        </>
                                    ) : null}
                                </span>
                            </div>
                        );
                    })}
                </section>
            ))}
        </div>
    );
}
