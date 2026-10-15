// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useContext, useEffect, useId } from 'react';
import { StatusMessage } from './StatusMessage.jsx';
import { FormNotices } from './formNoticeSlot.js';

/**
 * A StatusMessage written in the middle of a form body that is shown at the top
 * of the form instead, with the form's other notices. Every notice is the first
 * item of the page content; a line wedged between fields is easy to miss.
 *
 * The text is a plain string so the form can hold it by value. Outside a
 * FormPage, or with anything other than a string, the notice renders in place.
 *
 * @param {object} props
 * @param {'status' | 'info' | 'warning' | 'error' | 'success'} [props.variant]   default 'warning'
 * @param {'alert' | 'status' | 'note' | null} [props.role]                       as StatusMessage
 * @param {string | null | undefined} props.children
 */
export function FormNotice({ variant = 'warning', role, children }) {
    const notices = useContext(FormNotices);
    const id = useId();
    const text = typeof children === 'string' && children !== '' ? children : null;
    useEffect(() => {
        if (!notices) return undefined;
        notices.report(id, text ? { text, variant, role } : null);
        return () => notices.report(id, null);
    }, [notices, id, text, variant, role]);
    if (!children) return null;
    if (notices && text) return null;
    return <StatusMessage variant={variant} role={role}>{children}</StatusMessage>;
}
