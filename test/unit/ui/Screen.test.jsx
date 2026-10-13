// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { Screen, ScrollRestoration } from '../../../packages/core/src/ui/Screen.jsx';
import styles from '../../../packages/core/src/ui/Screen.module.css';

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
});

describe('<ScrollRestoration>', () => {
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
});
