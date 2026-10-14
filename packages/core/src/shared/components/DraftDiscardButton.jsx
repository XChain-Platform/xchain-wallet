// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { Button } from '@xchain-wallet/core/ui';

/**
 * The inline "Discard" link inside a form's saved-draft banner.
 *
 * The shared link variant keeps this action visually consistent with inline
 * links while retaining the 24px pointer-target floor in the kit stylesheet.
 *
 * @param {object} props
 * @param {() => void} props.onClick
 * @param {string} props.label    accessible name, e.g. "Discard saved draft"
 * @param {import('react').ReactNode} props.children   visible text
 */
export function DraftDiscardButton({ onClick, label, children }) {
    return (
        <Button
            type="button"
            variant="link"
            size="sm"
            icon={null}
            onClick={onClick}
            aria-label={label}
        >
            {children}
        </Button>
    );
}
