// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { Profiler } from 'react';
import { readFileSync } from 'node:fs';

import { Screen, ScrollRestoration } from '../../../packages/core/src/ui/Screen.jsx';
import styles from '../../../packages/core/src/ui/Screen.module.css';

const REVIEW_SCROLL_FORMS = [
    ['AddressPreferencesForm', "restoreScroll={!(stage === 'review' || stage === 'submitting')}"],
    ['AdvancedActionsForm', "restoreScroll={!(stage === 'review' || stage === 'submitting')}"],
    ['AttachContentForm', "restoreScroll={!stage.startsWith('review-')}"],
    ['BatchComposerForm', "restoreScroll={!(stage === 'review' || stage === 'submitting')}"],
    ['BroadcastForm', "restoreScroll={!(stage === 'review' || stage === 'submitting')}"],
    ['CallbackForm', "restoreScroll={!(stage === 'review' || stage === 'submitting')}"],
    ['CoinpayForm', "restoreScroll={!(stage === 'review' || stage === 'submitting')}"],
    ['ComposeMessage', "restoreScroll={!(stage === 'review' || stage === 'submitting')}"],
    ['ContractFundsForm', "restoreScroll={!(stage === 'review' || stage === 'submitting')}"],
    ['ContractStakeForm', "restoreScroll={!(stage === 'review' || stage === 'submitting')}"],
    ['ControllerBindForm', "restoreScroll={!(stage === 'review' || stage === 'submitting')}"],
    ['CreateOrderForm', "restoreScroll={!(stage === 'review' || stage === 'submitting')}"],
    ['CreatePollForm', "restoreScroll={!(stage === 'review' || stage === 'submitting')}"],
    ['CrossChainOrderForm', "restoreScroll={!(stage === 'review' || stage === 'submitting')}"],
    ['CrossChainSwapForm', "restoreScroll={!(stage === 'review' || stage === 'submitting')}"],
    ['DelegateVoteForm', "restoreScroll={!(stage === 'review' || stage === 'submitting')}"],
    ['DelegationActionForm', "restoreScroll={!(stage === 'review' || stage === 'submitting')}"],
    ['DestroyForm', "restoreScroll={!(stage === 'review' || stage === 'submitting')}"],
    ['DispenserForm', "restoreScroll={!(stage === 'review' || stage === 'submitting')}"],
    ['DividendForm', "restoreScroll={!(stage === 'review' || stage === 'submitting')}"],
    ['GatedPublishForm', "restoreScroll={!(stage === 'review' || stage === 'submitting')}"],
    ['IssueTokenForm', "restoreScroll={!(stage === 'review' || stage === 'submitting')}"],
    ['LinkForm', 'restoreScroll={!isReviewOrSubmitting}'],
    ['ListCreateForm', "restoreScroll={!(stage === 'review' || stage === 'submitting')}"],
    ['ListForkForm', "restoreScroll={stage !== 'review-1' && stage !== 'review-2'}"],
];

const originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport');

afterEach(() => {
    vi.restoreAllMocks();
    if (originalVisualViewport) {
        Object.defineProperty(window, 'visualViewport', originalVisualViewport);
    } else {
        delete window.visualViewport;
    }
});

describe('<Screen>', () => {
    it('renders the full variant with a named section body and optional landmarks', () => {
        const { container } = render(
            <Screen
                variant="full"
                bodyAs="section"
                bodyLabelledBy="activity-heading"
                header={<span>Wallet header</span>}
                footer={<span>Wallet footer</span>}
            >
                <h2 id="activity-heading">Activity</h2>
            </Screen>,
        );

        expect(container.firstChild).toHaveClass(styles.screen, styles.full);
        expect(screen.getByRole('banner')).toHaveTextContent('Wallet header');
        const body = screen.getByRole('region', { name: 'Activity' });
        expect(body).not.toHaveAttribute('id');
        expect(body).toHaveAttribute('tabindex', '-1');
        expect(screen.getByRole('contentinfo')).toHaveTextContent('Wallet footer');
    });

    it('renders a focusable main landmark in the small default variant', () => {
        const { container } = render(<Screen>Wallet content</Screen>);

        expect(container.firstChild).toHaveClass(styles.screen, styles.small);
        const main = screen.getByRole('main');
        expect(main).toHaveAttribute('id', 'xc-main');
        expect(main).toHaveAttribute('tabindex', '-1');
        expect(screen.queryByRole('banner')).not.toBeInTheDocument();
        expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
    });

    it('fits above a resized visual viewport and reveals the focused field', () => {
        let resize;
        const visualViewport = {
            height: 400,
            offsetTop: 0,
            addEventListener: vi.fn((type, listener) => {
                if (type === 'resize') resize = listener;
            }),
            removeEventListener: vi.fn(),
        };
        Object.defineProperty(window, 'visualViewport', {
            configurable: true,
            value: visualViewport,
        });
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
            callback();
            return 1;
        });

        const view = render(
            <Screen footer={<button type="button">Continue</button>}>
                <label htmlFor="phone-field">Amount</label>
                <input id="phone-field" />
            </Screen>,
        );
        const root = view.container.firstChild;
        const main = screen.getByRole('main');
        const field = screen.getByLabelText('Amount');
        vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({ top: 50, bottom: 650 });
        vi.spyOn(main, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 600 });
        vi.spyOn(field, 'getBoundingClientRect').mockReturnValue({ top: 500, bottom: 540 });
        field.focus();

        act(() => resize());

        expect(root.style.getPropertyValue('--xc-screen-visible-height')).toBe('350px');
        expect(main.scrollTop).toBe(152);
        expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();

        visualViewport.height = 700;
        act(() => resize());
        expect(root.style.getPropertyValue('--xc-screen-visible-height')).toBe('');
    });
});

describe('<ScrollRestoration>', () => {
    it('keeps consumers idle when a parent rerenders the same route', () => {
        let commits = 0;
        const child = (
            <Profiler id="screen" onRender={() => { commits += 1; }}>
                <Screen>Stable route</Screen>
            </Profiler>
        );
        const view = render(
            <ScrollRestoration routeKey="stable">{child}</ScrollRestoration>,
        );
        const initialCommits = commits;

        view.rerender(
            <ScrollRestoration routeKey="stable">{child}</ScrollRestoration>,
        );

        expect(initialCommits).toBe(1);
        expect(commits).toBe(initialCommits);
    });

    it('restores each route key to its last scroll offset', () => {
        const view = render(
            <ScrollRestoration routeKey="first">
                <Screen>First route</Screen>
            </ScrollRestoration>,
        );
        const body = screen.getByRole('main');
        body.scrollTop = 125;

        view.rerender(
            <ScrollRestoration routeKey="second">
                <Screen>Second route</Screen>
            </ScrollRestoration>,
        );
        expect(screen.getByRole('main').scrollTop).toBe(0);
        screen.getByRole('main').scrollTop = 48;

        view.rerender(
            <ScrollRestoration routeKey="first">
                <Screen>First route again</Screen>
            </ScrollRestoration>,
        );
        expect(screen.getByRole('main').scrollTop).toBe(125);

        view.rerender(
            <ScrollRestoration routeKey="second">
                <Screen>Second route again</Screen>
            </ScrollRestoration>,
        );
        expect(screen.getByRole('main').scrollTop).toBe(48);
    });

    it.each(REVIEW_SCROLL_FORMS)('%s opens its review at the top', (formName, wiring) => {
        const routeSource = readFileSync(
            `packages/core/src/shared/routes/${formName}.jsx`,
            'utf8',
        );
        expect(routeSource).toContain(wiring);

        const view = render(
            <ScrollRestoration routeKey={formName}>
                <Screen restoreScroll>Form</Screen>
            </ScrollRestoration>,
        );
        const body = screen.getByRole('main');
        body.scrollTop = 325;

        view.rerender(
            <ScrollRestoration routeKey={formName}>
                <Screen restoreScroll={false}>Review</Screen>
            </ScrollRestoration>,
        );

        expect(body.scrollTop).toBe(0);

        view.rerender(
            <ScrollRestoration routeKey={formName}>
                <Screen restoreScroll>Form again</Screen>
            </ScrollRestoration>,
        );
        expect(body.scrollTop).toBe(325);
    });
});
