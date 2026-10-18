// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '../../../packages/core/src/ui/Button.jsx';
import { Chip } from '../../../packages/core/src/ui/Chip.jsx';
import { Input } from '../../../packages/core/src/ui/Input.jsx';
import { ListRow } from '../../../packages/core/src/ui/ListRow.jsx';
import { Select } from '../../../packages/core/src/ui/Select.jsx';
import { Tabs } from '../../../packages/core/src/ui/Tabs.jsx';
import { Textarea } from '../../../packages/core/src/ui/Textarea.jsx';

const callerClass = 'caller-class';

describe('kit component class names', () => {
    it.each([
        ['Button', <Button className={callerClass}>Save</Button>, 'button'],
        ['Input', <Input aria-label="Name" className={callerClass} />, 'textbox'],
        ['Select', (
            <Select aria-label="Network" className={callerClass}>
                <option>Bitcoin</option>
            </Select>
        ), 'combobox'],
        ['Textarea', <Textarea aria-label="Notes" className={callerClass} />, 'textbox'],
        ['Chip', <Chip pressed={false} className={callerClass}>Watch</Chip>, 'button'],
        ['ListRow', <ListRow title="Account" onClick={() => {}} className={callerClass} />, 'button'],
        ['Tabs', (
            <Tabs
                aria-label="Wallet view"
                items={[{ id: 'coins', label: 'Coins' }]}
                value="coins"
                onChange={() => {}}
                className={callerClass}
            />
        ), 'tablist'],
    ])('appends a caller class after %s kit classes', (_name, component, role) => {
        render(component);
        const classNames = screen.getByRole(role).className.split(' ');

        expect(classNames.length).toBeGreaterThan(1);
        expect(classNames.at(-1)).toBe(callerClass);
    });

    it('keeps loading behavior when overlapping native props are supplied', () => {
        render(
            <Button loading disabled={false} aria-busy="false" type="submit">
                Save
            </Button>,
        );
        const button = screen.getByRole('button');

        expect(button).toHaveAttribute('type', 'submit');
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute('aria-busy', 'true');
    });
});
