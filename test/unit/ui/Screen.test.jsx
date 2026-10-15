// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { Profiler, useContext, useState } from 'react';
import { readFileSync } from 'node:fs';

import { Screen, ScrollRestoration, WalletRouteScope } from '../../../packages/core/src/ui/Screen.jsx';
import { ShellRouteOutlet } from '../../../packages/core/src/shared/components/ShellRouteOutlet.jsx';
import { CurrentRouteContext } from '../../../packages/core/src/shared/components/navSurface.js';
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

describe('<WalletRouteScope>', () => {
    const walletData = {
        'wallet-a': {
            home: ['A balance', 'A token filter', 'A pinned token'],
            history: ['A history row', 'A history filter'],
            send: ['A transaction draft'],
            receive: ['A selected address'],
        },
        'wallet-b': {
            home: ['B balance', 'B token filter', 'B pinned token'],
            history: ['B history row', 'B history filter'],
            send: ['B transaction draft'],
            receive: ['B selected address'],
        },
    };

    function MainScreen({ name, walletId }) {
        const [data] = useState(() => walletData[walletId][name]);
        return (
            <Screen>
                <h1>{name}</h1>
                {data.map((value) => <div key={value}>{value}</div>)}
            </Screen>
        );
    }

    it.each([
        ['home'],
        ['history'],
        ['send'],
        ['receive'],
    ])('shows only the selected wallet data and scroll on the %s screen', (routeKey) => {
        const tree = (walletId) => (
            <WalletRouteScope walletId={walletId} routeKey={routeKey}>
                <MainScreen name={routeKey} walletId={walletId} />
            </WalletRouteScope>
        );
        const view = render(
            tree('wallet-a'),
        );
        for (const value of walletData['wallet-a'][routeKey]) {
            expect(screen.getByText(value)).toBeInTheDocument();
        }
        screen.getByRole('main').scrollTop = 240;

        view.rerender(tree('wallet-b'));

        for (const value of walletData['wallet-a'][routeKey]) {
            expect(screen.queryByText(value)).not.toBeInTheDocument();
        }
        for (const value of walletData['wallet-b'][routeKey]) {
            expect(screen.getByText(value)).toBeInTheDocument();
        }
        expect(screen.getByRole('main').scrollTop).toBe(0);
        screen.getByRole('main').scrollTop = 80;

        view.rerender(tree('wallet-a'));

        expect(screen.getByRole('main').scrollTop).toBe(240);
        for (const value of walletData['wallet-b'][routeKey]) {
            expect(screen.queryByText(value)).not.toBeInTheDocument();
        }
    });
});

describe('<ShellRouteOutlet> wallet scope', () => {
    function RouteProbe() {
        const routeId = useContext(CurrentRouteContext);
        return <Screen><span data-testid="route-id">{routeId}</span></Screen>;
    }

    it('keeps the bare route id and starts another wallet at the top', () => {
        const tree = (walletId) => (
            <ShellRouteOutlet routeKey="history" walletId={walletId} onHome={() => {}}>
                <RouteProbe />
            </ShellRouteOutlet>
        );
        const view = render(tree('wallet-a'));
        expect(screen.getByTestId('route-id').textContent).toBe('history');
        screen.getByRole('main').scrollTop = 200;

        view.rerender(tree('wallet-b'));
        expect(screen.getByTestId('route-id').textContent).toBe('history');
        expect(screen.getByRole('main').scrollTop).toBe(0);

        view.rerender(tree('wallet-a'));
        expect(screen.getByRole('main').scrollTop).toBe(200);
    });
});
