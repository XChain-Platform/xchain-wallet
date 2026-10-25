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
import { Button, FormPage, Icon, StatusMessage } from '@xchain-wallet/core/ui';
import { logConsole } from '../utils/logConsole.js';
import styles from './RouteErrorBoundary.module.css';
import { t } from '../../i18n/index.js';

/**
 * Keeps a failed route from replacing the application with a blank screen.
 * The Home action changes only shell navigation state, so providers and the
 * unlocked session stay mounted. A boundary without shell navigation falls
 * back to reloading the application entry point. When the failing route is
 * Home itself (atHome), the Home action has nowhere to go, so the screen
 * offers only Try again, which remounts the route.
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
        logConsole.record({
            level: 'error',
            source: 'ui:route',
            message: 'Route render failed',
        });
        this.props.onError?.(error, info);
    }

    componentDidUpdate(previousProps) {
        if (this.state.failed && previousProps.resetKey !== this.props.resetKey) {
            this.setState({ failed: false });
        }
    }

    goHome = () => {
        if (this.props.onHome) {
            this.props.onHome();
            return;
        }
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
                <StatusMessage variant="error" recovery={{ label: t('home.retryBalances'), onAction: this.retry }}>
                    {t('components.routeErrorBoundary.couldNotLoadThisSection')}
                </StatusMessage>
            );
        }

        const actions = (
            <>
                {this.props.atHome ? null : (
                    <Button type="button" variant="secondary" icon={<Icon.HomeIcon />} onClick={this.goHome}>
                        {t('components.routeErrorBoundary.goToHome')}
                    </Button>
                )}
                <Button type="button" variant="primary" onClick={this.retry}>
                    {t('common.tryAgain')}
                </Button>
            </>
        );

        return (
            <div role="alert" className={styles.recovery}>
                <FormPage label={t('components.routeErrorBoundary.thisScreenCouldNotBe')} actions={actions}>
                    <h1 className={styles.title}>{t('components.routeErrorBoundary.thisScreenCouldNotBe')}</h1>
                    <p className={styles.body}>
                        {t('components.routeErrorBoundary.somethingWentWrongWhileShowing')}
                    </p>
                </FormPage>
            </div>
        );
    }
}
