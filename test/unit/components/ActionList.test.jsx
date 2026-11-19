// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The action list (G101) and the Actions | Details toggle (G102): a native
// list of kit rows, each with a tinted icon square, a title, a description
// and the trailing chevron; a red danger row; a disabled row that stays
// reachable and says why; and a two-tab toggle that opens on Actions,
// switches panels by click and keyboard and can remember the last tab.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ActionList, ActionListItem } from '../../../packages/core/src/shared/components/ActionList.jsx';
import { ActionsDetailsToggle } from '../../../packages/core/src/shared/components/ActionsDetailsToggle.jsx';

const Glyph = () => <svg data-testid="glyph" />;

beforeEach(() => {
    globalThis.localStorage?.clear();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    globalThis.localStorage?.clear();
});

describe('ActionList', () => {
    it('renders a named native list with one item per action', () => {
        render(
            <ActionList label="Order actions">
                <ActionListItem icon={<Glyph />} title="Edit order" description="Change the price" onClick={() => {}} />
                <ActionListItem icon={<Glyph />} title="Open market" description="See the book" href="#market" />
            </ActionList>,
        );
        const list = screen.getByRole('list', { name: 'Order actions' });
        expect(list.tagName).toBe('UL');
        expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    });

    it('names the list Actions when no label is given', () => {
        render(<ActionList><ActionListItem icon={<Glyph />} title="Edit order" onClick={() => {}} /></ActionList>);
        expect(screen.getByRole('list', { name: 'Actions' })).toBeTruthy();
    });

    it('renders rows from an items array', () => {
        const onEdit = vi.fn();
        render(
            <ActionList
                items={[
                    { id: 'edit', icon: <Glyph />, title: 'Edit order', description: 'Change the price', onClick: onEdit },
                    { id: 'cancel', icon: <Glyph />, title: 'Cancel order', tone: 'danger', onClick: () => {} },
                ]}
            />,
        );
        expect(screen.getAllByRole('listitem')).toHaveLength(2);
        fireEvent.click(screen.getByRole('button', { name: /Edit order/ }));
        expect(onEdit).toHaveBeenCalledTimes(1);
    });

    it('draws the icon square, title, description and chevron on a button row', () => {
        const onClick = vi.fn();
        render(
            <ActionList>
                <ActionListItem icon={<Glyph />} title="Edit order" description="Change the price, amount or expiry" onClick={onClick} />
            </ActionList>,
        );
        const row = screen.getByRole('button', { name: /Edit order/ });
        expect(row.tagName).toBe('BUTTON');
        expect(row.textContent).toContain('Change the price, amount or expiry');
        const tile = row.querySelector('[data-tone="default"][aria-hidden="true"]');
        expect(tile?.querySelector('[data-testid="glyph"]')).toBeTruthy();
        // The trailing chevron is the kit's aria-hidden forward glyph.
        const chevron = row.lastElementChild;
        expect(chevron?.getAttribute('aria-hidden')).toBe('true');
        expect(chevron?.querySelector('svg')).toBeTruthy();
        expect(chevron?.querySelector('[data-testid="glyph"]')).toBeNull();
        fireEvent.click(row);
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('renders an href row as a link with the chevron', () => {
        render(
            <ActionList>
                <ActionListItem icon={<Glyph />} title="View on the explorer" description="The order's transaction" href="https://explorer.xchain.io/tx/ab" />
            </ActionList>,
        );
        const link = screen.getByRole('link', { name: /View on the explorer/ });
        expect(link.getAttribute('href')).toBe('https://explorer.xchain.io/tx/ab');
        expect(link.querySelectorAll('svg').length).toBeGreaterThan(0);
    });

    it('drops the chevron only when asked', () => {
        render(
            <ActionList>
                <ActionListItem icon={<span>C</span>} title="Copy transaction ID" onClick={() => {}} chevron={false} />
            </ActionList>,
        );
        const row = screen.getByRole('button', { name: /Copy transaction ID/ });
        expect(row.querySelectorAll('svg')).toHaveLength(0);
    });

    it('draws a danger row with red text and a red-tinted icon', () => {
        render(
            <ActionList>
                <ActionListItem icon={<Glyph />} title="Cancel order" description="Returns the escrowed tokens" tone="danger" onClick={() => {}} />
            </ActionList>,
        );
        const row = screen.getByRole('button', { name: /Cancel order/ });
        expect(row.getAttribute('data-tone')).toBe('danger');
        expect(row.querySelector('[aria-hidden="true"][data-tone="danger"]')).toBeTruthy();
        const title = screen.getByText('Cancel order');
        expect(title.getAttribute('data-tone')).toBe('danger');
        expect(title.className).toMatch(/titleText/);
    });

    it('keeps a disabled row focusable, says why and ignores presses', () => {
        const onClick = vi.fn();
        render(
            <ActionList>
                <ActionListItem
                    icon={<Glyph />}
                    title="Edit order"
                    description="Change the price"
                    onClick={onClick}
                    disabled
                    disabledReason="A filled order cannot change"
                />
            </ActionList>,
        );
        const row = screen.getByRole('button', { name: /Edit order/ });
        expect(row.getAttribute('aria-disabled')).toBe('true');
        expect(row.hasAttribute('disabled')).toBe(false);
        const reason = screen.getByText('A filled order cannot change');
        expect(row.getAttribute('aria-describedby')).toBe(reason.id);
        expect(row.textContent).not.toContain('Change the price');
        row.focus();
        expect(document.activeElement).toBe(row);
        fireEvent.click(row);
        expect(onClick).not.toHaveBeenCalled();
        // A disabled row goes nowhere, so it carries no chevron.
        expect(row.querySelectorAll('svg')).toHaveLength(1);
    });

    it('turns a disabled href row into an inert button, not a live link', () => {
        render(
            <ActionList>
                <ActionListItem icon={<Glyph />} title="Open market" href="#market" disabled disabledReason="No market yet" />
            </ActionList>,
        );
        expect(screen.queryByRole('link')).toBeNull();
        const row = screen.getByRole('button', { name: /Open market/ });
        expect(row.getAttribute('aria-disabled')).toBe('true');
    });

    it('reaches every row by Tab, and Enter on a focused row runs it', () => {
        const onEdit = vi.fn();
        render(
            <ActionList>
                <ActionListItem icon={<Glyph />} title="Edit order" onClick={onEdit} />
                <ActionListItem icon={<Glyph />} title="Cancel order" tone="danger" onClick={() => {}} />
            </ActionList>,
        );
        const rows = screen.getAllByRole('button');
        for (const row of rows) expect(row.tabIndex).toBe(0);
        // A native button turns Enter and Space into a click; jsdom models the click.
        rows[0].focus();
        expect(document.activeElement).toBe(rows[0]);
        fireEvent.click(document.activeElement);
        expect(onEdit).toHaveBeenCalledTimes(1);
    });
});

describe('ActionsDetailsToggle', () => {
    const renderToggle = (props = {}) => render(
        <ActionsDetailsToggle
            actions={<ActionList><ActionListItem icon={<Glyph />} title="Edit order" onClick={() => {}} /></ActionList>}
            details={<p>Price 0.000004 BTC each</p>}
            {...props}
        />,
    );

    it('opens on Actions, first and selected, with only its panel rendered', () => {
        renderToggle();
        const tabs = screen.getAllByRole('tab');
        expect(tabs.map((tab) => tab.textContent)).toEqual(['Actions', 'Details']);
        expect(tabs[0].getAttribute('aria-selected')).toBe('true');
        expect(tabs[1].getAttribute('aria-selected')).toBe('false');
        expect(screen.getByRole('tablist', { name: 'Page sections' })).toBeTruthy();
        const panel = screen.getByRole('tabpanel');
        expect(panel.getAttribute('aria-labelledby')).toBe(tabs[0].id);
        expect(tabs[0].getAttribute('aria-controls')).toBe(panel.id);
        expect(within(panel).getByRole('list', { name: 'Actions' })).toBeTruthy();
        expect(screen.queryByText('Price 0.000004 BTC each')).toBeNull();
    });

    it('draws an icon on each tab', () => {
        renderToggle();
        for (const tab of screen.getAllByRole('tab')) expect(tab.querySelector('svg')).toBeTruthy();
    });

    it('switches panels on click', () => {
        renderToggle();
        fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
        const panel = screen.getByRole('tabpanel');
        expect(within(panel).getByText('Price 0.000004 BTC each')).toBeTruthy();
        expect(screen.queryByRole('list', { name: 'Actions' })).toBeNull();
        expect(panel.getAttribute('aria-labelledby')).toBe(screen.getByRole('tab', { name: /Details/ }).id);
    });

    it('moves between tabs with the arrow keys, Home and End', () => {
        renderToggle();
        const [actionsTab, detailsTab] = screen.getAllByRole('tab');
        expect(actionsTab.tabIndex).toBe(0);
        expect(detailsTab.tabIndex).toBe(-1);
        fireEvent.keyDown(actionsTab, { key: 'ArrowRight' });
        expect(detailsTab.getAttribute('aria-selected')).toBe('true');
        expect(document.activeElement).toBe(detailsTab);
        expect(screen.getByText('Price 0.000004 BTC each')).toBeTruthy();
        fireEvent.keyDown(detailsTab, { key: 'Home' });
        expect(actionsTab.getAttribute('aria-selected')).toBe('true');
        fireEvent.keyDown(actionsTab, { key: 'End' });
        expect(detailsTab.getAttribute('aria-selected')).toBe('true');
        fireEvent.keyDown(detailsTab, { key: 'ArrowLeft' });
        expect(actionsTab.getAttribute('aria-selected')).toBe('true');
    });

    it('does not remember the tab without a remember key', () => {
        const { unmount } = renderToggle();
        fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
        unmount();
        renderToggle();
        expect(screen.getByRole('tab', { name: /Actions/ }).getAttribute('aria-selected')).toBe('true');
    });

    it('remembers the last tab per remember key', () => {
        const { unmount } = renderToggle({ rememberKey: 'order' });
        fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
        expect(globalThis.localStorage.getItem('xc.actionsDetails.order')).toBe('details');
        unmount();
        renderToggle({ rememberKey: 'order' });
        expect(screen.getByRole('tab', { name: /Details/ }).getAttribute('aria-selected')).toBe('true');
        cleanup();
        renderToggle({ rememberKey: 'swap' });
        expect(screen.getByRole('tab', { name: /Actions/ }).getAttribute('aria-selected')).toBe('true');
    });

    it('ignores a stored value that is not a tab', () => {
        globalThis.localStorage.setItem('xc.actionsDetails.order', 'history');
        renderToggle({ rememberKey: 'order' });
        expect(screen.getByRole('tab', { name: /Actions/ }).getAttribute('aria-selected')).toBe('true');
    });

    it('falls back to Actions when storage throws', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
        renderToggle({ rememberKey: 'order' });
        expect(screen.getByRole('tab', { name: /Actions/ }).getAttribute('aria-selected')).toBe('true');
        fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
        expect(screen.getByText('Price 0.000004 BTC each')).toBeTruthy();
    });
});
