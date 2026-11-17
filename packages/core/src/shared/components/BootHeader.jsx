// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The frame for a page shown before any vault is open (a vault that will not
// open, a wallet that could not start): the standard app header with the
// logo, then the page header with the title (ruling 2026-11-13, every page
// has both). The wallet menu, the bell and Lock all need an open vault, so
// the header carries the logo alone, as the Locked screen does.

import { PageHeader } from '@xchain-wallet/core/ui';
import { AppHeader } from './AppHeader.jsx';

/**
 * The logo header above a page header the caller already built (an
 * onboarding step with its own back button and step line).
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.children  the page header
 */
export function BootFrame({ children }) {
    return (
        <>
            <AppHeader showMenu={false} />
            {children}
        </>
    );
}

/**
 * @param {object} props
 * @param {import('react').ReactNode} props.title
 */
export function BootHeader({ title }) {
    return (
        <BootFrame>
            <PageHeader title={title} />
        </BootFrame>
    );
}
