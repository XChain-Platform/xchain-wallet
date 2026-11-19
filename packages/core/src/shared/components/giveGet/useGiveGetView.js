// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Quick | Full view choice and the Full view's section open
// state for one Give/Get form. The host form calls this above its early
// returns (pickers, confirm, review) so both survive a picker round trip;
// the form's field values live in the host, so they survive a view switch.

import { useCallback, useState } from 'react';

const STORAGE_PREFIX = 'xc.giveGet.view.';
const VIEWS = ['quick', 'full'];

function readStoredView(formKey) {
    try {
        const raw = globalThis.localStorage?.getItem(STORAGE_PREFIX + formKey);
        return VIEWS.includes(raw) ? raw : null;
    } catch {
        // Private windows and blocked storage throw; fall back to the default.
        return null;
    }
}

function writeStoredView(formKey, view) {
    try {
        globalThis.localStorage?.setItem(STORAGE_PREFIX + formKey, view);
    } catch {
        // Remembering the view is a convenience; a refusal changes nothing else.
    }
}

/**
 * @param {string} formKey   one key per form ('swap', 'order', 'dispenser', 'crossChainSwap')
 * @param {object} [options]
 * @param {'quick' | 'full'} [options.defaultView]   used when nothing is stored
 * @param {Record<string, boolean>} [options.sections] initial open state of the Full view's sections
 */
export function useGiveGetView(formKey, {
    defaultView = 'quick',
    sections: initialSections,
    // The sections whose fields Quick shows inside its own terms
    // section, and that section's open-state key. Bet uses 'terms'.
    quickTerms = { key: 'options', sections: ['options'] },
} = {}) {
    const [view, setViewState] = useState(() => readStoredView(formKey) || defaultView);
    const [sections, setSections] = useState(() => ({
        give: true,
        get: true,
        options: false,
        ...(initialSections || {}),
    }));

    const setView = useCallback((next) => {
        if (!VIEWS.includes(next)) return;
        setViewState(next);
        writeStoredView(formKey, next);
    }, [formKey]);

    const setSectionOpen = useCallback((id, open) => {
        setSections((s) => (s[id] === open ? s : { ...s, [id]: open }));
    }, []);

    const toggleSection = useCallback((id) => {
        setSections((s) => ({ ...s, [id]: !s[id] }));
    }, []);

    // Reveal a section's fields (a submit error on a field the view
    // hides). Quick opens its own terms section in place when that field lives
    // there; any other section still switches to Full with it open.
    const quickTermsKey = quickTerms.key;
    const quickTermsList = quickTerms.sections.join(',');
    const openOptions = useCallback((id = 'options') => {
        setSectionOpen(id, true);
        if (view === 'quick' && quickTermsList.split(',').includes(id)) {
            setSectionOpen(quickTermsKey, true);
            return;
        }
        setView('full');
    }, [setSectionOpen, setView, view, quickTermsKey, quickTermsList]);

    return { view, setView, sections, setSectionOpen, toggleSection, openOptions };
}
