// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Safety surfaces: how protective states (panic mode today) are told to the
// user on the screens where they act, not just where they configured them.

export {
    PANIC_SURFACE_HOME,
    PANIC_SURFACE_SEND,
    PANIC_SURFACE_SIGN,
    formatPanicRemaining,
    panicFreezeNotice,
} from './panicNotice.js';

export {
    PanicFreezeNotice,
    SigningReadyNote,
    usePanicFreeze,
} from './PanicFreezeNotice.jsx';
