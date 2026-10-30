// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Safety page's notice for a panic-mode write the store refused. Signing
// is frozen in memory either way; what the user needs to know is whether the
// freeze is the saved one. Two states, one message each:
//
//   unsaved       panic mode is on but its record was refused, so a restart
//                 ends the freeze. Shown only for a freeze the user armed
//                 here: a duress-armed freeze stays silent, as everywhere.
//   clear-failed  turning it off was refused, so the freeze stays on.

import { useEffect, useRef, useState } from 'react';
import { FormNotice } from '@xchain-wallet/core/ui';
import {
    PANIC_ARMED_SELF,
    PANIC_SAVE_CLEAR_FAILED,
    PANIC_SAVE_UNSAVED,
    getPanicArmedBy,
    getPanicModeSaveStatus,
    subscribePanicModeSaveStatus,
} from '../../../flows/panicMode.js';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/settings.js';

/** @returns {'saved'|'unsaved'|'clear-failed'} */
export function usePanicModeSaveStatus() {
    const [status, setStatus] = useState(getPanicModeSaveStatus);
    useEffect(() => {
        setStatus(getPanicModeSaveStatus());
        return subscribePanicModeSaveStatus(setStatus);
    }, []);
    return status;
}

export function PanicSaveNotice() {
    const status = usePanicModeSaveStatus();
    const ref = useRef(/** @type {HTMLDivElement | null} */ (null));
    let notice = null;
    if (status === PANIC_SAVE_CLEAR_FAILED) {
        notice = (
            <FormNotice variant="error" testId="panic-save-notice" lead={t('settings.panic.couldNotTurnOff')}>
                {t('settings.panic.couldNotTurnOffDetail')}
            </FormNotice>
        );
    } else if (status === PANIC_SAVE_UNSAVED && getPanicArmedBy() === PANIC_ARMED_SELF) {
        notice = (
            <FormNotice variant="error" testId="panic-save-notice" lead={t('settings.panic.notSaved')}>
                {t('settings.panic.notSavedDetail')}
            </FormNotice>
        );
    }
    // The user turns panic mode on or off from the row further down the
    // page, so the notice at the top is brought into view when it appears.
    const shown = notice !== null;
    useEffect(() => {
        if (shown) ref.current?.scrollIntoView?.({ block: 'nearest' });
    }, [shown, status]);
    if (!notice) return null;
    return <div ref={ref}>{notice}</div>;
}
