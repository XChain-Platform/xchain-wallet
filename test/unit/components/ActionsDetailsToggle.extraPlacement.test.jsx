// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A page's own third tab sits between Actions and Details (the oracle
// record's Markets), or after Details when it sets `after` (Dispenser
// detail's Activity, a list tab that follows the facts). Only the chosen
// panel renders either way.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import React from 'react';
import { ActionsDetailsToggle } from '../../../packages/core/src/shared/components/ActionsDetailsToggle.jsx';

afterEach(() => cleanup());

function mount(extra) {
    return render(
        <ActionsDetailsToggle
            label="Sections"
            actions={<p>actions panel</p>}
            details={<p>details panel</p>}
            extra={extra}
        />,
    );
}

const tabNames = (utils) => within(utils.getByRole('tablist', { name: 'Sections' }))
    .getAllByRole('tab').map((tab) => tab.textContent);

describe('ActionsDetailsToggle extra tab placement', () => {
    it('places the extra tab between Actions and Details by default', () => {
        const utils = mount({ id: 'markets', label: 'Markets', icon: null, panel: <p>markets panel</p> });
        expect(tabNames(utils)).toEqual(['Actions', 'Markets', 'Details']);
    });

    it('places the extra tab after Details when it sets after', () => {
        const utils = mount({ id: 'activity', label: 'Activity', icon: null, after: true, panel: <p>activity panel</p> });
        expect(tabNames(utils)).toEqual(['Actions', 'Details', 'Activity']);
        expect(utils.getByText('actions panel')).toBeTruthy();
        fireEvent.click(utils.getByRole('tab', { name: 'Activity' }));
        expect(utils.getByText('activity panel')).toBeTruthy();
        expect(utils.queryByText('actions panel')).toBeNull();
        expect(utils.getByRole('tabpanel').getAttribute('data-view')).toBe('activity');
    });

    it('moves between all three tabs with the arrow keys in their shown order', () => {
        const utils = mount({ id: 'activity', label: 'Activity', icon: null, after: true, panel: <p>activity panel</p> });
        const actions = utils.getByRole('tab', { name: 'Actions' });
        actions.focus();
        fireEvent.keyDown(actions, { key: 'End' });
        expect(utils.getByRole('tab', { name: 'Activity' }).getAttribute('aria-selected')).toBe('true');
    });
});
