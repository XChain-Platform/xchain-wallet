// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The open state of a standard form's sections, held by the host so
// it survives a picker page. Call it above the form's early returns (the
// pickers, the review step), as useGiveGetView is called.

import { useCallback, useState } from 'react';

/**
 * @param {Record<string, boolean>} initial   open state per section id; the
 *        standard opens only the main section: { from: false, main: true, fee: false }
 * @returns {{
 *   sections: Record<string, boolean>,
 *   isOpen: (id: string) => boolean,
 *   setOpen: (id: string, open: boolean) => void,
 *   toggle: (id: string) => void,
 *   bind: (id: string) => { open: boolean, onOpenChange: (open: boolean) => void, main?: true },
 * }}
 */
export function useFormSections(initial = {}) {
    const [sections, setSections] = useState(() => ({ ...initial }));
    // A section the form opens on load (other than From and the fee)
    // is its main section; bind() marks it so FormSection renders data-form-main.
    const [mainIds] = useState(() => new Set(
        Object.keys(initial).filter((id) => initial[id] && id !== 'from' && id !== 'fee'),
    ));
    const setOpen = useCallback((id, open) => {
        setSections((s) => (Boolean(s[id]) === Boolean(open) ? s : { ...s, [id]: Boolean(open) }));
    }, []);
    const toggle = useCallback((id) => {
        setSections((s) => ({ ...s, [id]: !s[id] }));
    }, []);
    const isOpen = (id) => Boolean(sections[id]);
    // Spread onto a FormSection, FromSection or FeeSection (the last two ignore `main`).
    const bind = (id) => ({
        open: Boolean(sections[id]),
        onOpenChange: (open) => setOpen(id, open),
        ...(mainIds.has(id) ? { main: true } : {}),
    });
    return { sections, isOpen, setOpen, toggle, bind };
}
