// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CommandPalette } from '../../../packages/core/src/shared/commandPalette/CommandPalette.jsx';

afterEach(() => cleanup());

function makeCommands() {
    return [
        { id: 'home', category: 'Navigate', title: 'Home', run: vi.fn() },
        { id: 'send', category: 'Navigate', title: 'Send', run: vi.fn() },
        { id: 'settings', category: 'Settings', title: 'Settings', run: vi.fn() },
    ];
}

const getInput = () => screen.getByRole('combobox');

describe('CommandPalette', () => {
    it('renders nothing when closed', () => {
        const { container } = render(
            <CommandPalette open={false} onClose={() => {}} commands={makeCommands()} />,
        );
        expect(container.firstChild).toBeNull();
    });

    it('renders a modal dialog with all commands when open', () => {
        render(<CommandPalette open onClose={() => {}} commands={makeCommands()} />);
        expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
        expect(screen.getByRole('option', { name: /Home/ })).toBeTruthy();
        expect(screen.getByRole('option', { name: /Send/ })).toBeTruthy();
        expect(screen.getByRole('option', { name: /Settings/ })).toBeTruthy();
    });

    it('pre-selects the first result (§33.2)', () => {
        render(<CommandPalette open onClose={() => {}} commands={makeCommands()} />);
        expect(screen.getByRole('option', { name: /Home/ })).toHaveAttribute('aria-selected', 'true');
    });

    it('filters as the user types', () => {
        render(<CommandPalette open onClose={() => {}} commands={makeCommands()} />);
        fireEvent.change(getInput(), { target: { value: 'sett' } });
        expect(screen.queryByRole('option', { name: /Home/ })).toBeNull();
        expect(screen.getByRole('option', { name: /Settings/ })).toBeTruthy();
    });

    it('shows an empty state when nothing matches', () => {
        render(<CommandPalette open onClose={() => {}} commands={makeCommands()} />);
        fireEvent.change(getInput(), { target: { value: 'zzzzz' } });
        expect(screen.queryAllByRole('option')).toHaveLength(0);
        expect(screen.getByText(/No matches/)).toBeTruthy();
    });

    it('Arrow keys move the selection and wrap', () => {
        render(<CommandPalette open onClose={() => {}} commands={makeCommands()} />);
        const input = getInput();
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        expect(screen.getByRole('option', { name: /Send/ })).toHaveAttribute('aria-selected', 'true');
        fireEvent.keyDown(input, { key: 'ArrowUp' });
        expect(screen.getByRole('option', { name: /Home/ })).toHaveAttribute('aria-selected', 'true');
        // Up from the first result wraps to the last.
        fireEvent.keyDown(input, { key: 'ArrowUp' });
        expect(screen.getByRole('option', { name: /Settings/ })).toHaveAttribute('aria-selected', 'true');
    });

    it('Enter runs the selected command and closes', () => {
        const commands = makeCommands();
        const onClose = vi.fn();
        render(<CommandPalette open onClose={onClose} commands={commands} />);
        fireEvent.keyDown(getInput(), { key: 'ArrowDown' }); // select "Send"
        fireEvent.keyDown(getInput(), { key: 'Enter' });
        expect(commands[1].run).toHaveBeenCalledOnce();
        expect(commands[0].run).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('clicking a row runs that command and closes', () => {
        const commands = makeCommands();
        const onClose = vi.fn();
        render(<CommandPalette open onClose={onClose} commands={commands} />);
        fireEvent.click(screen.getByRole('option', { name: /Settings/ }));
        expect(commands[2].run).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('Escape closes without running anything', () => {
        const commands = makeCommands();
        const onClose = vi.fn();
        render(<CommandPalette open onClose={onClose} commands={commands} />);
        fireEvent.keyDown(getInput(), { key: 'Escape' });
        expect(onClose).toHaveBeenCalledOnce();
        for (const c of commands) expect(c.run).not.toHaveBeenCalled();
    });

    it('Tab jumps the selection to the next category (§33.4)', () => {
        render(<CommandPalette open onClose={() => {}} commands={makeCommands()} />);
        // Start on Home (Navigate). Tab -> first row of the next category (Settings).
        fireEvent.keyDown(getInput(), { key: 'Tab' });
        expect(screen.getByRole('option', { name: /Settings/ })).toHaveAttribute('aria-selected', 'true');
    });

    it('prepends parseQuery (§33.3) results above the fuzzy matches and pre-selects them', () => {
        const run = vi.fn();
        const parseQuery = (q) =>
            /^send /i.test(q) ? [{ id: 'ff', category: 'Suggested', title: `Do: ${q}`, run }] : [];
        render(
            <CommandPalette open onClose={() => {}} commands={makeCommands()} parseQuery={parseQuery} />,
        );
        // A non-intent query shows no synthetic row.
        fireEvent.change(getInput(), { target: { value: 'settings' } });
        expect(screen.queryByRole('option', { name: /^Do:/ })).toBeNull();

        // An intent query prepends the synthetic row as the pre-selected top result.
        fireEvent.change(getInput(), { target: { value: 'send 5 doge' } });
        const options = screen.getAllByRole('option');
        expect(options[0]).toHaveTextContent('Do: send 5 doge');
        expect(options[0]).toHaveAttribute('aria-selected', 'true');
        fireEvent.keyDown(getInput(), { key: 'Enter' });
        expect(run).toHaveBeenCalledOnce();
    });

    it('re-renders cleanly when one category splits into multiple groups (no stale rows)', () => {
        // Score-sorted results can interleave categories, so the same
        // category renders as several consecutive-run groups. Group keys
        // must stay unique or React leaves zombie option rows behind on
        // the next keystroke (the e2e regression).
        const mk = (id, category, title) => ({ id, category, title, run: () => {} });
        const commands = [
            mk('a1', 'Navigate', 'alpha one'),
            mk('s1', 'Settings', 'alpha settings'),
            mk('a2', 'Navigate', 'alpha two'),
            mk('s2', 'Settings', 'alpha more settings'),
        ];
        render(<CommandPalette open onClose={() => {}} commands={commands} />);
        // 'alpha' matches all four; title scoring interleaves the categories.
        fireEvent.change(getInput(), { target: { value: 'alpha' } });
        expect(screen.getAllByRole('option')).toHaveLength(4);
        // Narrowing must drop rows, not orphan them in the DOM.
        fireEvent.change(getInput(), { target: { value: 'alpha one' } });
        const after = screen.getAllByRole('option');
        expect(after).toHaveLength(1);
        expect(after[0]).toHaveTextContent('alpha one');
    });
});
