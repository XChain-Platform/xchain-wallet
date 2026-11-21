// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useContext, useEffect, useId, useRef } from 'react';
import { StatusMessage } from './StatusMessage.jsx';
import { FormNotices } from './formNoticeSlot.js';
import { NoticeList } from './NoticeList.jsx';

/**
 * A StatusMessage written in the middle of a form body that is shown first in
 * the page content instead (above the card when wide), with the form's other notices. Every notice is the first
 * item of the page content; a line wedged between fields is easy to miss.
 *
 * The text is a plain string so the form can hold it by value. A message of
 * several lines (one per decoder warning or per reason) passes them as
 * `lines`, an array of strings, and stays one box with a paragraph per line.
 * Lines that are separate issues (one per decoder warning, one per blocker)
 * also pass `bullets`, so several read as a bulleted list (U101); lines that
 * are one message's sentences leave it off and stay plain paragraphs.
 * A notice title ("Destroy is irreversible.") passes as `title`, also a plain
 * string, and sits on its own line above the body. `lead` remains a legacy
 * alias and uses the same block title slot.
 * Outside a FormPage, or with anything other than strings, the notice renders
 * in place.
 *
 * @param {object} props
 * @param {'info' | 'danger' | 'success'} [props.tone]                          the Notice Standard tone; wins over `variant`
 * @param {'status' | 'info' | 'warning' | 'error' | 'success'} [props.variant]   older name for the tone, default 'warning' (danger paint)
 * @param {'alert' | 'status' | 'note' | null} [props.role]                       as StatusMessage
 * @param {string} [props.lead]                                                   legacy alias for `title`
 * @param {string} [props.title]                                                  bold title on its own line above the text (the Notice Standard title), never run together with it
 * @param {string} [props.testId]                                                 data-testid on the notice box
 * @param {() => void} [props.onDismiss]                                           makes the notice dismissible (close button in its top end corner)
 * @param {readonly string[] | null} [props.lines]                               one paragraph per entry, in place of children
 * @param {boolean} [props.bullets]                                              the lines are separate issues: several render as a bulleted list
 * @param {string | null | undefined} [props.children]
 */
export function FormNotice({ tone, variant: variantProp = 'warning', role, lead, title, testId, lines, bullets = false, children, onDismiss }) {
    const variant = tone || variantProp;
    const notices = useContext(FormNotices);
    const id = useId();
    // The slot holds the entry by value, so the dismiss handler is read through
    // a ref and the entry carries one stable function.
    const onDismissRef = useRef(onDismiss);
    onDismissRef.current = onDismiss;
    const dismissible = typeof onDismiss === 'function';
    const dismiss = useCallback(() => onDismissRef.current?.(), []);
    const list = Array.isArray(lines) ? lines : null;
    const allText = list ? list.length > 0 && list.every((line) => typeof line === 'string' && line !== '') : false;
    // The joined lines are the notice's value, so an equal list re-rendered is
    // not a new notice.
    const text = list
        ? (allText ? list.join('\n') : null)
        : (typeof children === 'string' && children !== '' ? children : null);
    const multiline = !!list;
    const shownLead = typeof lead === 'string' && lead !== '' ? lead : undefined;
    const shownTitle = typeof title === 'string' && title !== '' ? title : shownLead;
    useEffect(() => {
        if (!notices) return undefined;
        notices.report(id, text ? { text, variant, role, title: shownTitle, testId, lines: multiline ? text.split('\n') : undefined, bullets: multiline && bullets ? true : undefined, onDismiss: dismissible ? dismiss : undefined } : null);
        return () => notices.report(id, null);
    }, [notices, id, text, variant, role, shownTitle, testId, multiline, bullets, dismissible, dismiss]);
    if (list ? list.length === 0 : !children) return null;
    if (notices && text) return null;
    return (
        <StatusMessage variant={variant} role={role} title={shownTitle} testId={testId} onDismiss={dismissible ? dismiss : undefined}>
            {list ? <NoticeLines lines={list} bullets={bullets} /> : children}
        </StatusMessage>
    );
}

/**
 * The lines of a notice of several lines: plain paragraphs, or with
 * `bullets` a bulleted list of issues when there are several (U101).
 *
 * @param {object} props
 * @param {readonly import('react').ReactNode[]} props.lines
 * @param {boolean} [props.bullets]
 */
export function NoticeLines({ lines, bullets = false }) {
    if (bullets) return <NoticeList items={lines.map((line, i) => ({ key: i, content: line }))} />;
    return lines.map((line, i) => (
        <p key={i}>{line}</p>
    ));
}
