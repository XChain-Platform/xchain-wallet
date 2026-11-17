// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The Destination networks field (Bridge settings, G117) shows the icons of
// the chosen networks. The wallet grows to many networks, so the field draws
// at most the first five icons and folds the rest into a "+N more" label,
// while its accessible name still lists every chosen network.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';

import {
    NETWORKS_FIELD_MAX_ICONS,
    NetworksField,
    networksFieldIcons,
} from '../../../packages/core/src/shared/components/NetworksField.jsx';

afterEach(cleanup);

// Eighteen networks with names long enough that any two overflow the names
// budget, so every multi-network choice takes the icon form.
const OPTIONS = Array.from({ length: 18 }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    return { value: `N${n}`, title: `Network ${n}`, chainId: `net${n}-mainnet` };
});

function mount(count) {
    const selected = OPTIONS.slice(0, count).map((o) => o.value);
    render(React.createElement(NetworksField, {
        label: 'Destination networks',
        options: OPTIONS,
        selected,
        placeholder: 'None set',
        onOpenPicker() {},
    }));
    return screen.getByRole('button', { name: /^Destination networks: / });
}

const icons = (field) => field.querySelectorAll('[data-network-value]');
const more = (field) => field.querySelector('[data-networks-more]');
const allNames = (count) => OPTIONS.slice(0, count).map((o) => o.title).join(', ');

describe('NetworksField icon cap', () => {
    it('caps the icons at five', () => {
        expect(NETWORKS_FIELD_MAX_ICONS).toBe(5);
        expect(networksFieldIcons(0)).toEqual({ shown: 0, more: 0 });
        expect(networksFieldIcons(5)).toEqual({ shown: 5, more: 0 });
        expect(networksFieldIcons(18)).toEqual({ shown: 5, more: 13 });
    });

    it('0 chosen: the placeholder, no icons, no more label', () => {
        const field = mount(0);
        expect(field).toHaveAccessibleName('Destination networks: None set');
        expect(field).toHaveTextContent('None set');
        expect(icons(field)).toHaveLength(0);
        expect(more(field)).toBeNull();
    });

    it('3 chosen: three icons, no more label, all three named', () => {
        const field = mount(3);
        expect(icons(field)).toHaveLength(3);
        expect(more(field)).toBeNull();
        expect(field).toHaveAccessibleName(`Destination networks: ${allNames(3)}`);
    });

    it('5 chosen: five icons, no more label', () => {
        const field = mount(5);
        expect(icons(field)).toHaveLength(5);
        expect(more(field)).toBeNull();
        expect(field).toHaveAccessibleName(`Destination networks: ${allNames(5)}`);
    });

    it('6 chosen: the first five icons and "+1 more"', () => {
        const field = mount(6);
        expect([...icons(field)].map((el) => el.getAttribute('data-network-value')))
            .toEqual(['N01', 'N02', 'N03', 'N04', 'N05']);
        expect(more(field)).toHaveTextContent('+1 more');
        expect(field).toHaveAccessibleName(`Destination networks: ${allNames(6)}`);
    });

    it('18 chosen: the first five icons and "+13 more", every network in the name', () => {
        const field = mount(18);
        expect(icons(field)).toHaveLength(5);
        expect(more(field)).toHaveTextContent('+13 more');
        expect(field).toHaveAccessibleName(`Destination networks: ${allNames(18)}`);
        expect(field.getAttribute('aria-label')).toContain('Network 18');
    });

    it('six short names still take the capped icon form', () => {
        const short = Array.from({ length: 6 }, (_, i) => ({ value: `S${i}`, title: String.fromCharCode(65 + i) }));
        render(React.createElement(NetworksField, {
            label: 'Destination networks',
            options: short,
            selected: short.map((o) => o.value),
            placeholder: 'None set',
            onOpenPicker() {},
        }));
        const field = screen.getByRole('button', { name: /^Destination networks: / });
        expect(icons(field)).toHaveLength(5);
        expect(more(field)).toHaveTextContent('+1 more');
    });
});
