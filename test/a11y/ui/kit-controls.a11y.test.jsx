// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Checkbox } from '../../../packages/core/src/ui/Checkbox.jsx';
import { Chip } from '../../../packages/core/src/ui/Chip.jsx';
import { ListRow } from '../../../packages/core/src/ui/ListRow.jsx';
import { RadioGroup } from '../../../packages/core/src/ui/RadioGroup.jsx';
import { SegmentedControl } from '../../../packages/core/src/ui/SegmentedControl.jsx';
import { Switch } from '../../../packages/core/src/ui/Switch.jsx';
import { Tabs } from '../../../packages/core/src/ui/Tabs.jsx';
import { expectNoSeriousAxeViolations } from '../helpers/axe.js';

const noop = () => {};
const tabItems = [
    { id: 'overview', label: 'Overview' },
    { id: 'activity', label: 'Activity' },
];
const segmentItems = [
    { id: 'list', label: 'List' },
    { id: 'grid', label: 'Grid' },
];
const radioOptions = [
    { value: 'private', label: 'Private', description: 'Only you can see it.' },
    { value: 'public', label: 'Public', description: 'Anyone can see it.' },
];

function KitState({ state }) {
    const selected = state === 'selected';
    const disabled = state === 'disabled';
    const error = state === 'error' ? 'Choose a valid setting.' : undefined;

    return (
        <section aria-label={`${state} kit controls`}>
            <ListRow
                title="Wallet account"
                subtitle="Primary account"
                onClick={noop}
                disabled={disabled}
                aria-current={selected ? 'true' : undefined}
                aria-invalid={error ? 'true' : undefined}
            />
            <Chip
                pressed={selected}
                disabled={disabled}
                onPressedChange={noop}
                aria-invalid={error ? 'true' : undefined}
            >Watchlist</Chip>
            <Tabs
                aria-label="Wallet section"
                items={tabItems}
                value={selected ? 'activity' : 'overview'}
                onChange={noop}
                aria-disabled={disabled ? 'true' : undefined}
                aria-invalid={error ? 'true' : undefined}
            />
            <SegmentedControl
                aria-label="Layout"
                items={disabled
                    ? [segmentItems[0], { ...segmentItems[1], disabled: true }]
                    : segmentItems}
                value={selected ? 'grid' : 'list'}
                onChange={noop}
                aria-invalid={error ? 'true' : undefined}
            />
            <Checkbox
                label="Back up wallet"
                description="Keep a recoverable copy."
                checked={selected}
                disabled={disabled}
                error={error}
                onChange={noop}
            />
            <RadioGroup
                legend="Visibility"
                value={selected ? 'public' : 'private'}
                onChange={noop}
                options={radioOptions}
                disabled={disabled}
                error={error}
            />
            <Switch
                label="Price alerts"
                description="Notify when the target is reached."
                checked={selected}
                disabled={disabled}
                aria-invalid={error ? 'true' : undefined}
                onChange={noop}
            />
        </section>
    );
}

afterEach(cleanup);

for (const theme of ['light', 'dark']) {
    describe(`${theme} theme kit accessibility`, () => {
        for (const state of ['default', 'selected', 'disabled', 'error']) {
            it(`${state} state has no serious axe violations`, async () => {
                const { container } = render(
                    <div data-xc-theme={theme}>
                        <KitState state={state} />
                    </div>,
                );

                await expectNoSeriousAxeViolations(container);
            });
        }
    });
}

function KeyboardTabs() {
    const [value, setValue] = useState('overview');
    return (
        <Tabs
            aria-label="Keyboard tabs"
            items={tabItems}
            value={value}
            onChange={setValue}
        />
    );
}

function KeyboardSegments() {
    const [value, setValue] = useState('first');
    return (
        <SegmentedControl
            aria-label="Keyboard segments"
            value={value}
            onChange={setValue}
            items={[
                { id: 'first', label: 'First' },
                { id: 'disabled', label: 'Disabled', disabled: true },
                { id: 'last', label: 'Last' },
            ]}
        />
    );
}

describe('kit arrow-key navigation', () => {
    it('moves Tabs selection and focus in both directions', () => {
        render(<KeyboardTabs />);
        const overview = screen.getByRole('tab', { name: 'Overview' });
        const activity = screen.getByRole('tab', { name: 'Activity' });

        overview.focus();
        fireEvent.keyDown(overview, { key: 'ArrowRight' });
        expect(activity).toHaveFocus();
        expect(activity).toHaveAttribute('aria-selected', 'true');

        fireEvent.keyDown(activity, { key: 'ArrowLeft' });
        expect(overview).toHaveFocus();
        expect(overview).toHaveAttribute('aria-selected', 'true');
    });

    it('moves SegmentedControl selection and skips disabled choices', () => {
        render(<KeyboardSegments />);
        const first = screen.getByRole('radio', { name: 'First' });
        const disabled = screen.getByRole('radio', { name: 'Disabled' });
        const last = screen.getByRole('radio', { name: 'Last' });

        first.focus();
        fireEvent.keyDown(first, { key: 'ArrowRight' });
        expect(last).toHaveFocus();
        expect(last).toHaveAttribute('aria-checked', 'true');
        expect(disabled).toHaveAttribute('tabindex', '-1');

        fireEvent.keyDown(last, { key: 'ArrowLeft' });
        expect(first).toHaveFocus();
        expect(first).toHaveAttribute('aria-checked', 'true');
    });
});
