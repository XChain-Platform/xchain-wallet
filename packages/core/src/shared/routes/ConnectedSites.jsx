// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// : Connected Sites as a top-level screen.
//
// `ConnectedSitesSection` is the §35.1 / §43.5 panel body. Until now the
// only way to see it was Settings -> Connected Sites, i.e. a drilldown
// nested inside another screen. Shells that want dApp permissions as a
// destination of their own (the MV3 popup reaches it from the command
// palette, where "Sites" results are their own category) mount THIS,
// which is the same body under its own header - not a fork of the panel.
//
// Deliberately thin: no state, no data loading. Everything the screen
// does lives in the shared section, so the standalone route and the
// Settings drilldown can never drift apart.

import { Screen, PageHeader } from '@xchain-wallet/core/ui';
import { screenVariantFor, useMessaging } from '../useMessaging.js';
import { ConnectedSitesSection } from '../components/settings/ConnectedSitesSection.jsx';
import styles from './ActionsMenu.module.css';

/**
 * @param {object} props
 * @param {() => void} props.onBack
 */
export function ConnectedSites({ onBack }) {
    const { shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const header = <PageHeader onBack={onBack} title="Connected Sites" />;
    return (
        <Screen variant={variant} header={header}>
            <div className={styles.listPopup}>
                <ConnectedSitesSection />
            </div>
        </Screen>
    );
}
