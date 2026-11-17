// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// G118: a group of on/off options is a card of icon rows with a switch on the
// right, never a checkbox list. Covers the shared OptionSwitchList, the Give/Get
// ownership toggle and the style-guide Issue token example.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { OptionSwitch, OptionSwitchList } from '../../../packages/core/src/ui/OptionSwitchList.jsx';
import { KeyIcon } from '../../../packages/core/src/ui/icons/index.jsx';
import { OwnershipToggle } from '../../../packages/core/src/shared/components/giveGet/OwnershipToggle.jsx';
import { ExampleSectionedFormScreen } from '../../../packages/web/src/style-guide/sections/templateExamples.jsx';

afterEach(cleanup);

function expectIconSwitches(container, count) {
    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(count);
    expect(container.querySelectorAll('input[type="checkbox"]:not([role="switch"])')).toHaveLength(0);
    for (const input of switches) {
        expect(input.closest('label').querySelector('[aria-hidden="true"] svg')).toBeTruthy();
    }
}

describe('OptionSwitchList', () => {
    it('draws each option as an icon row with a switch and flips it on click', () => {
        const onChange = vi.fn();
        const { container } = render(
            <OptionSwitchList>
                <OptionSwitch icon={<KeyIcon />} label="One" description="First" checked={false} onChange={onChange} />
                <OptionSwitch icon={<KeyIcon />} label="Two" checked onChange={vi.fn()} />
            </OptionSwitchList>,
        );
        expectIconSwitches(container, 2);
        fireEvent.click(screen.getByRole('switch', { name: 'One' }));
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('switch', { name: 'Two' })).toBeChecked();
    });
});

describe('OwnershipToggle', () => {
    it('is a one-row icon switch card that reports the new value', () => {
        const onChange = vi.fn();
        const { container } = render(<OwnershipToggle label="Give ownership" checked={false} onChange={onChange} />);
        expectIconSwitches(container, 1);
        fireEvent.click(screen.getByRole('switch', { name: 'Give ownership' }));
        expect(onChange).toHaveBeenCalledWith(true);
    });
});

describe('style-guide Issue token example', () => {
    it('lists Settings as icon switches, not checkboxes', () => {
        const { container } = render(<ExampleSectionedFormScreen />);
        expectIconSwitches(container, 2);
        expect(screen.getByRole('switch', { name: 'Divisible' })).toBeChecked();
        expect(screen.getByRole('switch', { name: 'Lock supply' })).not.toBeChecked();
    });
});
