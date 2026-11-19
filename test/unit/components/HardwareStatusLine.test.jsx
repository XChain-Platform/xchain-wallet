// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The shared one-line step status: a check when done, an X when failed, a
// ring while running, each state said in words for assistive tech.

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { HardwareStatusLine } from '../../../packages/core/src/shared/components/hardware/index.js';

afterEach(cleanup);

const SIGN_STEPS = [
    { label: 'Device', state: 'done' },
    { label: 'Unlock', state: 'done' },
    { label: 'Confirm', state: 'active' },
    { label: 'Signed', state: 'todo' },
];

describe('HardwareStatusLine', () => {
    it('draws one ordered step per entry, in order, under its label', () => {
        render(<HardwareStatusLine steps={SIGN_STEPS} />);

        const line = screen.getByRole('list', { name: 'Progress' });
        expect(line.tagName).toBe('OL');
        const items = [...line.querySelectorAll('li')];
        expect(items.map((li) => li.getAttribute('data-state'))).toEqual(['done', 'done', 'active', 'todo']);
        expect(items.map((li) => li.querySelector('[aria-hidden="true"] + span')?.textContent)).toEqual(
            ['Device', 'Unlock', 'Confirm', 'Signed'],
        );
    });

    it('says each state in words and marks the running step current', () => {
        render(<HardwareStatusLine steps={SIGN_STEPS} />);

        expect(screen.getByText('Device: done')).toBeInTheDocument();
        expect(screen.getByText('Confirm: in progress')).toBeInTheDocument();
        expect(screen.getByText('Signed: not started')).toBeInTheDocument();
        const current = document.querySelectorAll('[aria-current="step"]');
        expect(current).toHaveLength(1);
        expect(current[0]).toHaveAttribute('data-state', 'active');
    });

    it('draws a check for done and an X for failed, and nothing in a waiting circle', () => {
        const { container } = render(
            <HardwareStatusLine
                label="Connection progress"
                steps={[
                    { label: 'Plugged in', state: 'done' },
                    { label: 'Unlock', state: 'failed' },
                    { label: 'Allow XChain', state: 'todo' },
                ]}
            />,
        );

        expect(screen.getByRole('list', { name: 'Connection progress' })).toBeInTheDocument();
        const [done, failed, todo] = container.querySelectorAll('li');
        expect(done.querySelector('svg')).toBeInTheDocument();
        expect(failed.querySelector('svg')).toBeInTheDocument();
        expect(done.querySelector('svg').innerHTML).not.toBe(failed.querySelector('svg').innerHTML);
        expect(todo.querySelector('svg')).toBeNull();
        expect(screen.getByText('Unlock: failed')).toBeInTheDocument();
    });

    it('reads an unknown state as not started', () => {
        const { container } = render(<HardwareStatusLine steps={[{ label: 'Device', state: 'odd' }]} />);

        expect(container.querySelector('li')).toHaveAttribute('data-state', 'todo');
    });
});
