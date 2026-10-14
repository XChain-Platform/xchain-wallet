// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Operator ruling: the app header and the page header never show
// notifications. Shell notices render as the first row of the route's
// scrolling body, below the page header, and keep their state across routes.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useContext, useState } from 'react';
import { FullLayoutWithNav } from '../../../packages/core/src/shared/components/LeftNav.jsx';
import { ReachabilityNoticeHiddenContext } from '../../../packages/core/src/shared/components/noticesRoute.js';
import { HideReachabilityNotice } from '../../../packages/core/src/shared/components/hideReachabilityNotice.js';
import { Screen } from '../../../packages/core/src/ui/Screen.jsx';

afterEach(cleanup);

function Notice() {
    const [count, setCount] = useState(0);
    return (
        <div data-testid="notice">
            <span>Some balances may be out of date</span>
            <button type="button" onClick={() => setCount((n) => n + 1)}>Pressed {count}</button>
        </div>
    );
}

function Shell({ route, children }) {
    return (
        <FullLayoutWithNav
            routeKey={route}
            nav={<nav />}
            header={<div data-testid="app-header">Wallet: Main</div>}
            notices={<Notice />}
        >
            {children}
        </FullLayoutWithNav>
    );
}

function Route({ title, children }) {
    return (
        <Screen header={<h1>{title}</h1>}>
            <p data-testid={`content-${title}`}>{title} content</p>
            {children}
        </Screen>
    );
}

const follows = (a, b) => Boolean(b.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('shell notices placement', () => {
    it('renders notices inside the Screen body, below the page header and above the content', () => {
        render(<Shell route="send"><Route title="Send" /></Shell>);
        const notice = screen.getByTestId('notice');
        const main = screen.getByRole('main');
        const pageHeader = screen.getByRole('heading', { name: 'Send' }).closest('header');

        expect(main.contains(notice)).toBe(true);
        expect(pageHeader.contains(notice)).toBe(false);
        expect(screen.getByTestId('app-header').contains(notice)).toBe(false);
        expect(follows(notice, pageHeader)).toBe(true);
        expect(follows(screen.getByTestId('content-Send'), notice)).toBe(true);
        // The notices row is the first thing in the scrolling body.
        expect(main.firstElementChild.contains(notice)).toBe(true);
    });

    it('renders the notices once when a Screen nests another Screen', () => {
        render(
            <Shell route="send">
                <Route title="Send">
                    <Route title="Network" />
                </Route>
            </Shell>,
        );
        expect(screen.getAllByTestId('notice')).toHaveLength(1);
        const outerMain = screen.getAllByRole('main')[0];
        expect(outerMain.firstElementChild.contains(screen.getByTestId('notice'))).toBe(true);
    });

    it('keeps notice state when the route changes and moves it into the new Screen', () => {
        const view = render(<Shell route="send"><Route key="send" title="Send" /></Shell>);
        fireEvent.click(screen.getByRole('button', { name: 'Pressed 0' }));
        expect(screen.getByRole('button', { name: 'Pressed 1' })).toBeInTheDocument();

        view.rerender(<Shell route="home"><Route key="home" title="Home" /></Shell>);
        const notice = screen.getByTestId('notice');
        expect(screen.getByRole('button', { name: 'Pressed 1' })).toBeInTheDocument();
        expect(screen.getByRole('main').contains(notice)).toBe(true);
        expect(follows(screen.getByTestId('content-Home'), notice)).toBe(true);
    });

    it('hands the notices back to the route when an overlay Screen closes', () => {
        const view = render(
            <Shell route="send">
                <Route key="send" title="Send" />
                <Route key="overlay" title="Scan" />
            </Shell>,
        );
        expect(screen.getAllByTestId('notice')).toHaveLength(1);
        view.rerender(<Shell route="send"><Route key="send" title="Send" /></Shell>);
        const sendMain = screen.getByTestId('content-Send').closest('main');
        expect(sendMain.contains(screen.getByTestId('notice'))).toBe(true);
    });

    it('shows the notices above a route that renders no Screen', () => {
        render(<Shell route="plain"><p data-testid="plain">Plain route</p></Shell>);
        const notice = screen.getByTestId('notice');
        expect(notice.isConnected).toBe(true);
        expect(follows(screen.getByTestId('plain'), notice)).toBe(true);
        expect(screen.getByTestId('app-header').contains(notice)).toBe(false);
    });

    it('adds no notices row to a Screen outside the unlocked shell', () => {
        render(<Route title="Locked" />);
        expect(screen.queryByTestId('notice')).toBeNull();
        expect(screen.getByRole('main').firstElementChild).toBe(screen.getByTestId('content-Locked'));
    });

    it('lets a screen that states the balance problem itself hide the reachability notice', () => {
        function HideAware() {
            return <p data-testid="hide-aware">{useContext(ReachabilityNoticeHiddenContext) ? 'hidden' : 'shown'}</p>;
        }
        const shell = (children) => (
            <FullLayoutWithNav routeKey="home" nav={<nav />} notices={<HideAware />}>{children}</FullLayoutWithNav>
        );
        const view = render(shell(<Route title="Home"><HideReachabilityNotice /></Route>));
        expect(screen.getByTestId('hide-aware')).toHaveTextContent('hidden');
        view.rerender(shell(<Route title="Home" />));
        expect(screen.getByTestId('hide-aware')).toHaveTextContent('shown');
    });
});
