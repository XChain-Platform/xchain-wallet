// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { Component } from 'react';
import { Button, FormPage } from '@xchain-wallet/core/ui';
import styles from './RouteErrorBoundary.module.css';

/**
 * Keeps a failed route from replacing the application with a blank screen.
 * The Home action changes only shell navigation state, so providers and the
 * unlocked session stay mounted. Reload remains available when Home itself
 * is the failing route or the boundary covers a non-wallet screen.
 */
export class RouteErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { failed: false };
    }

    static getDerivedStateFromError() {
        return { failed: true };
    }

    componentDidCatch(error, info) {
        this.props.onError?.(error, info);
    }

    componentDidUpdate(previousProps) {
        if (this.state.failed && previousProps.resetKey !== this.props.resetKey) {
            this.setState({ failed: false });
        }
    }

    reload = () => {
        if (this.props.onReload) {
            this.props.onReload();
            return;
        }
        if (typeof window !== 'undefined') window.location.reload();
    };

    retry = () => {
        this.props.onRetry?.();
        this.setState({ failed: false });
    };

    render() {
        if (!this.state.failed) return this.props.children;

        if (this.props.variant === 'compact') {
            return (
                <div role="alert" className={styles.compactRecovery}>
                    <span>Could not load this section.</span>
                    <Button type="button" variant="secondary" size="sm" onClick={this.retry}>
                        Retry
                    </Button>
                </div>
            );
        }

        const actions = (
            <>
                {this.props.onHome ? (
                    <Button type="button" variant="secondary" onClick={this.props.onHome}>
                        Back to Home
                    </Button>
                ) : null}
                <Button type="button" variant="primary" onClick={this.retry}>
                    Try again
                </Button>
                <Button type="button" variant="secondary" onClick={this.reload}>
                    Reload
                </Button>
            </>
        );

        return (
            <div role="alert" className={styles.recovery}>
                <FormPage label="This screen could not be shown" actions={actions}>
                    <h1 className={styles.title}>This screen could not be shown</h1>
                    <p className={styles.body}>
                        {this.props.onHome
                            ? 'Something went wrong while showing this screen. Try again, go back Home without locking your wallet, or reload the app.'
                            : 'Something went wrong while showing this screen. Try again or reload the app.'}
                    </p>
                </FormPage>
            </div>
        );
    }
}
