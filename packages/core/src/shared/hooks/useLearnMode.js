// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// useLearnMode. Reads `settings.learnMode` off the <html>
// attribute that DisplayPrefsGate stamps, rather than through the settings
// context.
//
// Deliberate: the confirmation surfaces that carry the explanatory copy are
// presentational components rendered from several hosts (and from tests)
// that do not all sit under <MessagingProvider>. Reading an attribute keeps
// them provider-free while still tracking the live setting.

import { useEffect, useState } from 'react';
import { LEARN_MODE_ATTR } from './useSettingsRootAttributes.js';

function readLearnMode() {
    if (typeof document === 'undefined') return false;
    const root = document.documentElement;
    if (!root || typeof root.getAttribute !== 'function') return false;
    return root.getAttribute(LEARN_MODE_ATTR) === 'on';
}

/** @returns {boolean} whether Settings > Developer Mode > Learn Mode is on */
export function useLearnMode() {
    const [on, setOn] = useState(readLearnMode);

    useEffect(() => {
        // Re-seed: the attribute can land between the lazy initialiser and
        // this effect (the vault unlocks a tick after the first paint).
        setOn(readLearnMode());
        if (typeof MutationObserver !== 'function' || typeof document === 'undefined') return undefined;
        const root = document.documentElement;
        if (!root) return undefined;
        const obs = new MutationObserver(() => setOn(readLearnMode()));
        obs.observe(root, { attributes: true, attributeFilter: [LEARN_MODE_ATTR] });
        return () => obs.disconnect();
    }, []);

    return on;
}
