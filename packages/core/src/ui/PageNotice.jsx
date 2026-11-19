// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { createContext, useContext } from 'react';
import { createPortal } from 'react-dom';
import { StatusMessage } from './StatusMessage.jsx';
import styles from './FormPage.module.css';

/** The page-level DOM destination for notices raised by nested content. */
export const PageNoticeHostContext = createContext(/** @type {HTMLElement | null} */ (null));

/**
 * Draw a standard notice at the page notice host when one is available.
 * Outside a hosted page it stays where the caller rendered it.
 */
export function PageNotice({ text, tone, children, ...props }) {
    const host = useContext(PageNoticeHostContext);
    const content = children ?? text;
    if (content === null || content === undefined || content === '') return null;
    const variant = props.variant
        ?? (tone === 'error' || tone === 'warning' || tone === 'success' ? tone : 'status');
    const notice = (
        <StatusMessage {...props} variant={variant}>
            {content}
        </StatusMessage>
    );
    return host ? createPortal(<div className={styles.status}>{notice}</div>, host) : notice;
}
