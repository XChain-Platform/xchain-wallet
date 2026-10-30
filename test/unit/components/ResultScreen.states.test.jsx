// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Every result state opens with a StatusMessage notice and closes with the
// same action row, so a form's outcome reads the same whichever state it is in.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ResultScreen, RESULT_STATES } from '../../../packages/core/src/shared/components/ResultScreen.jsx';

afterEach(() => cleanup());

const PROPS = {
    success: { message: 'Minted 5 coins.', title: 'Done' },
    failure: { message: 'The network refused the transaction.', title: 'Failed' },
    pending: { message: 'Waiting for the first confirmation.', title: 'Pending' },
    'signed-not-broadcast': { what: 'mint' },
    unsigned: { result: { psbtHex: 'deadbeef' } },
};

const EXPECTED = {
    success: { tone: 'success', role: 'status' },
    failure: { tone: 'error', role: 'alert' },
    pending: { tone: 'info', role: 'status' },
    'signed-not-broadcast': { tone: 'warning', role: 'status' },
    unsigned: { tone: 'info', role: 'status' },
};

describe('ResultScreen states', () => {
    it('covers every state the tests describe', () => {
        expect([...RESULT_STATES].sort()).toEqual(Object.keys(PROPS).sort());
    });

    for (const state of Object.keys(PROPS)) {
        describe(state, () => {
            it('renders the notice as the first content, in its tone and role', () => {
                const { container } = render(<ResultScreen state={state} onDone={() => {}} {...PROPS[state]} />);
                const first = container.firstElementChild;
                expect(first.getAttribute('data-testid')).toBe('result-screen-notice');
                expect(first.getAttribute('data-variant')).toBe(EXPECTED[state].tone);
                expect(first.getAttribute('role')).toBe(EXPECTED[state].role);
            });

            it('closes with an action row whose primary button is Done', () => {
                const onDone = vi.fn();
                const { container } = render(<ResultScreen state={state} onDone={onDone} {...PROPS[state]} />);
                const row = container.lastElementChild;
                const buttons = row.querySelectorAll('button');
                expect(buttons[buttons.length - 1].textContent).toBe('Done');
                fireEvent.click(buttons[buttons.length - 1]);
                expect(onDone).toHaveBeenCalledTimes(1);
            });
        });
    }

    it('shows details between the notice and the action row for the generic states', () => {
        const { container } = render(
            <ResultScreen state="success" message="Sent." onDone={() => {}}>
                <p>Transaction ID abc</p>
            </ResultScreen>,
        );
        const kids = [...container.children];
        expect(kids).toHaveLength(3);
        expect(kids[0].getAttribute('data-testid')).toBe('result-screen-notice');
        expect(kids[1].textContent).toBe('Transaction ID abc');
        expect(kids[2].querySelectorAll('button')).toHaveLength(1);
    });

    it('puts the secondary action before Done', () => {
        const onSecondary = vi.fn();
        render(
            <ResultScreen
                state="failure"
                message="Could not send."
                onDone={() => {}}
                secondaryLabel="Try again"
                onSecondary={onSecondary}
            />,
        );
        const buttons = screen.getAllByRole('button');
        expect(buttons.map((b) => b.textContent)).toEqual(['Try again', 'Done']);
        fireEvent.click(buttons[0]);
        expect(onSecondary).toHaveBeenCalledTimes(1);
    });

    it('offers Build another beside Done in the unsigned state', () => {
        const onBuildAnother = vi.fn();
        render(<ResultScreen state="unsigned" result={{ psbtHex: 'deadbeef' }} onBuildAnother={onBuildAnother} onDone={() => {}} />);
        const buttons = screen.getAllByRole('button').filter((b) => ['Build another', 'Done'].includes(b.textContent));
        expect(buttons.map((b) => b.textContent)).toEqual(['Build another', 'Done']);
        fireEvent.click(buttons[0]);
        expect(onBuildAnother).toHaveBeenCalledTimes(1);
    });

    it('never offers a second signing action in the signed-not-broadcast state', () => {
        render(<ResultScreen state="signed-not-broadcast" onDone={() => {}} what="mint" />);
        expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Done']);
    });
});
