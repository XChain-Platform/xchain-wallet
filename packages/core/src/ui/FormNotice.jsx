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
 * A StatusMessage written in the middle of a form body that is shown first in
 * the page content instead (above the card when wide), with the form's other notices. Every notice is the first
 * item of the page content; a line wedged between fields is easy to miss.
 *
 * The text is a plain string so the form can hold it by value. A message of
 * several lines (one per decoder warning or per reason) passes them as
 * `lines`, an array of strings, and stays one box with a paragraph per line.
 * A bold lead-in sentence ("Destroy is irreversible.") passes as `lead`, also
 * a plain string; it opens the text, or the first line, in bold.
 * Outside a FormPage, or with anything other than strings, the notice renders
 * in place.
 *
 * @param {object} props
 * @param {'status' | 'info' | 'warning' | 'error' | 'success'} [props.variant]   default 'warning'
 * @param {'alert' | 'status' | 'note' | null} [props.role]                       as StatusMessage
 * @param {string} [props.lead]                                                   bold sentence that opens the notice
 * @param {string} [props.testId]                                                 data-testid on the notice box
 * @param {readonly string[] | null} [props.lines]                                one paragraph per entry, in place of children
 * @param {string | null | undefined} [props.children]
 */
export function FormNotice({ variant = 'warning', role, lead, testId, lines, children }) {
    const notices = useContext(FormNotices);
    const id = useId();
    const list = Array.isArray(lines) ? lines : null;
    const allText = list ? list.length > 0 && list.every((line) => typeof line === 'string' && line !== '') : false;
    // The joined lines are the notice's value, so an equal list re-rendered is
    // not a new notice.
    const text = list
        ? (allText ? list.join('\n') : null)
        : (typeof children === 'string' && children !== '' ? children : null);
    const multiline = !!list;
    const shownLead = typeof lead === 'string' && lead !== '' ? lead : undefined;
    useEffect(() => {
        if (!notices) return undefined;
        notices.report(id, text ? { text, variant, role, lead: shownLead, testId, lines: multiline ? text.split('\n') : undefined } : null);
        return () => notices.report(id, null);
    }, [notices, id, text, variant, role, shownLead, testId, multiline]);
    if (list ? list.length === 0 : !children) return null;
    if (notices && text) return null;
    return (
        <StatusMessage variant={variant} role={role} lead={list ? undefined : shownLead} testId={testId}>
            {list ? <NoticeLines lead={shownLead} lines={list} /> : children}
        </StatusMessage>
    );
}

/**
 * The paragraphs of a notice of several lines, the bold lead-in opening the
 * first one.
 *
 * @param {object} props
 * @param {string} [props.lead]
 * @param {readonly import('react').ReactNode[]} props.lines
 */
export function NoticeLines({ lead, lines }) {
    return lines.map((line, i) => (
        <p key={i}>
            {i === 0 && lead ? <><strong>{lead}</strong>{' '}</> : null}
            {line}
        </p>
    ));
}
