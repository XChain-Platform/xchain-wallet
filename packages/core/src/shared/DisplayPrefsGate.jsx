// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// DisplayPrefsGate mount point. Renders nothing; bridges the
// display-wide settings (theme, reduced motion, learn mode) into
// useSettingsRootAttributes so every shell that wraps its tree in
// <MessagingProvider> honours them without duplicating the wiring.
//
// Same shape as PrivacyBlurGate: one mount, no props, inert while the
// wallet is locked apart from replaying the cached preference.

import { useSettings } from './hooks/useSettings.js';
import { useSettingsRootAttributes } from './hooks/useSettingsRootAttributes.js';

export function DisplayPrefsGate() {
    const { settings } = useSettings();
    useSettingsRootAttributes(settings);
    return null;
}
