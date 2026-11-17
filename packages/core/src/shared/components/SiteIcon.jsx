// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { IdentityAvatar } from './WalletIdentity.jsx';
import { isSiteIconDataUrl, siteInitials } from '../../schemas/siteIcon.js';

/**
 * A connected site's own icon, or its coloured initials when it has none.
 *
 * `icon` is page data captured at connect time (ConnectedSite.icon), so it is
 * re-checked here and rendered only as `<img src="data:image/png...">`; any
 * other value (a URL, the legacy appIcon string, a non-PNG data URL) falls
 * back to the initials, so the wallet never fetches a site icon. The tone is
 * seeded by origin, so a site keeps its colour across views.
 *
 * @param {object} props
 * @param {string} props.origin
 * @param {string} [props.name]          declared app name; an origin-shaped name is ignored for initials
 * @param {string | null} [props.icon]   ConnectedSite.icon
 * @param {'header'|'list'|'hero'} [props.context]
 * @param {string} [props.className]
 */
export function SiteIcon({ origin, name = '', icon = null, context = 'list', className = '' }) {
    const src = isSiteIconDataUrl(icon) ? icon : null;
    return (
        <span data-testid="site-icon" data-site-icon={src ? 'image' : 'initials'} style={{ display: 'inline-flex' }}>
            <IdentityAvatar
                name={name || origin}
                seed={origin}
                context={context}
                src={src}
                text={siteInitials(name, origin)}
                className={className}
            />
        </span>
    );
}
