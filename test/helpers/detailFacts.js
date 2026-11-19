// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Reads the Details facts card of a History or Action detail view (the
// shared FactRows dl: a dt label and its dd value per fact).

import { screen } from '@testing-library/react';

/** The label's own words, without its help tip or screen-reader extras. */
function labelText(dt) {
    const copy = dt.cloneNode(true);
    copy.querySelectorAll('button, [role="tooltip"], .sr-only').forEach((node) => node.remove());
    return copy.textContent.trim();
}

/** The open Details panel (the toggle's tabpanel, named by its tab). */
export function detailsPanel(root = screen) {
    return root.getByRole('tabpanel', { name: 'Details' });
}

/** Every fact label in the panel, in order. */
export function factLabels(panel = detailsPanel()) {
    return [...panel.querySelectorAll('dt')].map(labelText);
}

/** The dd holding the value for one fact label, or null when absent. */
export function queryFact(label, panel = detailsPanel()) {
    const dt = [...panel.querySelectorAll('dt')].find((node) => labelText(node) === label);
    return dt ? dt.nextElementSibling : null;
}

/** The dd holding the value for one fact label; throws when absent. */
export function fact(label, panel = detailsPanel()) {
    const dd = queryFact(label, panel);
    if (!dd) throw new Error(`No Details fact labelled "${label}" (have: ${factLabels(panel).join(', ')})`);
    return dd;
}
