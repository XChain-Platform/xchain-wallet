// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The header every approval window carries (ruling 2026-11-13): the logo
// header without the wallet menu or the bell (the window has no open
// navigation), then the page header with the request title. G121 reserves
// help icons for editable fields, so this page header has no help control.

import { PageHeader } from '@xchain-wallet/core/ui';
import { AppHeader } from '@xchain-wallet/core/shared/components/AppHeader.jsx';
import styles from './ApprovalHeader.module.css';

/**
 * @param {object} props
 * @param {import('react').ReactNode} props.title  the request title
 */
export function ApprovalHeader({ title }) {
    return (
        <>
            <div className={styles.bleed}>
                <AppHeader showMenu={false} />
            </div>
            <PageHeader title={title} />
        </>
    );
}
