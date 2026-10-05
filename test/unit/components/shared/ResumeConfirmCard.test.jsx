// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The resume card must say the transaction was not sent, and wire each
// button to the right callback with the described session id.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

const flows = vi.hoisted(() => ({
    resumableSessions: vi.fn(),
    describeResumeSession: vi.fn(),
}));
vi.mock('@xchain-wallet/core', () => ({ flows }));

import { ResumeConfirmCard } from '../../../../packages/core/src/shared/components/ResumeConfirmCard.jsx';

function offer(sessions) {
    flows.resumableSessions.mockReturnValue(sessions);
    flows.describeResumeSession.mockImplementation((s) => ({ id: s.id, label: s.label }));
}

function mount(props = {}) {
    return render(
        <ResumeConfirmCard
            sessions={[]}
            onResume={vi.fn()}
            onDiscard={vi.fn()}
            {...props}
        />,
    );
}

beforeEach(() => {
    flows.resumableSessions.mockReset();
    flows.describeResumeSession.mockReset();
});
afterEach(() => { cleanup(); });

describe('ResumeConfirmCard: empty offer', () => {
    it('renders nothing and filters the sessions prop', () => {
        const sessions = [{ id: 'x' }];
        flows.resumableSessions.mockReturnValue([]);
        const { container } = mount({ sessions });
        expect(container.innerHTML).toBe('');
        expect(flows.resumableSessions).toHaveBeenCalledWith(sessions);
        expect(flows.describeResumeSession).not.toHaveBeenCalled();
    });
});

describe('ResumeConfirmCard: one session', () => {
    beforeEach(() => offer([{ id: 's1', label: 'Send 1 BTC' }]));

    it('renders the group, card and resume copy', () => {
        mount();
        const group = screen.getByRole('group', { name: 'Unfinished transactions' });
        expect(group.querySelectorAll('[data-testid="resume-confirm-card"]')).toHaveLength(1);
        const resume = screen.getByTestId('resume-confirm-s1');
        expect(resume.textContent).toContain('Finish Send 1 BTC');
        expect(resume.textContent).toContain('Not sent yet. Approve to sign and send it.');
    });

    it('labels the discard button with the session', () => {
        mount();
        const discard = screen.getByTestId('discard-confirm-s1');
        expect(discard.getAttribute('aria-label')).toBe('Discard unfinished Send 1 BTC');
    });

    it('resume calls onResume only', () => {
        const onResume = vi.fn();
        const onDiscard = vi.fn();
        mount({ onResume, onDiscard });
        fireEvent.click(screen.getByTestId('resume-confirm-s1'));
        expect(onResume).toHaveBeenCalledWith('s1');
        expect(onDiscard).not.toHaveBeenCalled();
    });

    it('discard calls onDiscard only', () => {
        const onResume = vi.fn();
        const onDiscard = vi.fn();
        mount({ onResume, onDiscard });
        fireEvent.click(screen.getByTestId('discard-confirm-s1'));
        expect(onDiscard).toHaveBeenCalledWith('s1');
        expect(onResume).not.toHaveBeenCalled();
    });
});

describe('ResumeConfirmCard: several sessions', () => {
    const a = { id: 'a', label: 'Send A' };
    const b = { id: 'b', label: 'Send B' };

    it('renders one card per session in order, each with the className', () => {
        offer([a, b]);
        mount({ className: 'resume-row' });
        const cards = screen.getAllByTestId('resume-confirm-card');
        expect(cards).toHaveLength(2);
        expect(cards.map((c) => c.className)).toEqual(['resume-row', 'resume-row']);
        expect(cards[0].textContent).toContain('Send A');
        expect(cards[1].textContent).toContain('Send B');
    });

    it('describes each offerable session once with that session', () => {
        offer([a, b]);
        mount();
        expect(flows.describeResumeSession).toHaveBeenCalledTimes(2);
        expect(flows.describeResumeSession).toHaveBeenNthCalledWith(1, a);
        expect(flows.describeResumeSession).toHaveBeenNthCalledWith(2, b);
    });
});
