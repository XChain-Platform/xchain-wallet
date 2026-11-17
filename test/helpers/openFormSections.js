// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect } from 'vitest';

// The Form Standard keeps every section except the form's main one closed,
// and a closed section's fields are hidden from role and name queries. A test
// opens the section by its title before it reads or types into a field there.

/**
 * Open one standard section by its title ("From", "Network fee", "Memo").
 * Waits for the section to render, and leaves an open one open.
 *
 * @param {string} title the section's title, matched as the start of the header's name
 * @returns {Promise<HTMLElement>} the section's header button
 */
export async function openSection(title) {
    const matcher = new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\b|$)`);
    const toggle = await waitFor(() => {
        const found = screen.getAllByRole('button', { name: matcher })
            .find((button) => button.hasAttribute('data-form-section-toggle'));
        if (!found) throw new Error(`no section named ${title}`);
        return found;
    });
    if (toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute('aria-expanded')).toBe('true'));
    return toggle;
}
