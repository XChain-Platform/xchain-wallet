// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { FormPage, Icon, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { t } from '../../i18n/index.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { ActionList, ActionListItem } from '../components/ActionList.jsx';
import { BootHeader } from '../components/BootHeader.jsx';
import bootLogo from '../../branding/images/xchain-boot-logo-228.png?inline';
import styles from './Loading.module.css';

/**
 * @param {object} props
 * @param {unknown} [props.error]
 * @param {() => void} [props.onRetry] defaults to reloading the app
 */
export function Loading({ error, onRetry }) {
    const { shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const centerClass = variant === 'small' ? styles.centerPopup : styles.centerFull;

    function handleRetry() {
        if (onRetry) { onRetry(); return; }
        if (typeof window !== 'undefined') window.location.reload();
    }

    return (
        <Screen
            variant={variant}
            header={error ? <BootHeader title={t('loading.failure.title')} /> : undefined}
        >
            <div className={centerClass}>
                {error ? (
                    <FormPage
                        label={t('loading.failure.title')}
                        onSubmit={(event) => event.preventDefault()}
                    >
                        <div className={styles.errorPanel}>
                            {/* One message for the state: the next step rides in the
                                same notice, never as a loose paragraph under it. */}
                            <StatusMessage variant="error">
                                {t('loading.error.body')}
                            </StatusMessage>
                            <ActionList label={t('vaultUnavailable.actions.label')}>
                                <ActionListItem
                                    icon={<Icon.RefreshIcon />}
                                    onClick={handleRetry}
                                    title={t('common.tryAgain')}
                                />
                            </ActionList>
                        </div>
                    </FormPage>
                ) : (
                    // The loading screen is only the fading logo and one
                    // progress bar: no app bar and no page header (operator
                    // 2026-11-15). The bar's accessible name is the only text.
                    <div className={styles.boot} role="status" aria-label={t('loading.opening')}>
                        <img className={styles.bootLogo} src={bootLogo} alt="" width="152" height="94" />
                        <div className={styles.bootBar} role="progressbar" aria-label={t('loading.opening')}>
                            <span className={styles.bootBarFill} />
                        </div>
                    </div>
                )}
            </div>
        </Screen>
    );
}
