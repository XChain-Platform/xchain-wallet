// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { Button, Icon, StatusMessage } from '@xchain-wallet/core/ui';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';
import styles from './DraftNotice.module.css';

/**
 * The shared saved-draft offer shown at the top of a form.
 *
 * Restore is the notice's only visible action. Closing discards the saved
 * draft, hides the notice, and lets the fresh form resume autosaving.
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.children
 * @param {() => void} props.onRestore
 * @param {() => void} props.onDiscard
 * @param {import('react').ReactNode} [props.title]
 * @param {string} [props.restoreLabel]
 */
export function DraftNotice({
    children,
    onRestore,
    onDiscard,
    title = null,
    restoreLabel = null,
}) {
    return (
        <StatusMessage
            variant="status"
            title={title ?? t('components.draftNotice.saved')}
            className={styles.notice}
            onDismiss={onDiscard}
            dismissLabel={t('components.draftNotice.discard')}
            testId="draft-notice"
        >
            <p>{children}</p>
            <div className={styles.actions} data-draft-actions="">
                <Button
                    type="button"
                    variant="success"
                    block
                    icon={<Icon.RefreshIcon />}
                    className={styles.restore}
                    onClick={onRestore}
                >
                    {restoreLabel ?? t('components.draftNotice.restore')}
                </Button>
            </div>
        </StatusMessage>
    );
}
