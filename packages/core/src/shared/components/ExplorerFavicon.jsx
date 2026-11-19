// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useState } from 'react';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import styles from '../routes/History.module.css';

/**
 * The icon of a "View on <explorer>" action row: that explorer's own logo.
 * Sources are bundled assets (branding.explorerLogoUrl), so no row ever
 * fetches a remote favicon. An explorer with no bundled logo, or whose logo
 * fails to load, shows its initial instead. ActionList draws it at the
 * standard row icon size.
 *
 * @param {object} props
 * @param {string | null | undefined} props.src         bundled logo URL
 * @param {string} props.label                          explorer name
 * @param {string} [props.explorerId]                   transaction-explorer entry id
 */
export function ExplorerFavicon({ src, label, explorerId }) {
    const [failed, setFailed] = useState(false);
    if (failed || !src) {
        return <span className={styles.detailActionIcon} aria-hidden="true">{String(label).charAt(0)}</span>;
    }
    return (
        <img
            src={src}
            alt=""
            aria-hidden="true"
            data-explorer-logo={explorerId}
            className={styles.detailActionFavicon}
            onError={() => setFailed(true)}
        />
    );
}

const PRODUCT_NAME = 'XChain';

/** The XChain explorer's row icon (the wallet's own XChain logo). */
export function XChainExplorerIcon() {
    return <ExplorerFavicon src={branding.explorerLogoUrl('xchain')} label={PRODUCT_NAME} explorerId="xchain" />;
}
