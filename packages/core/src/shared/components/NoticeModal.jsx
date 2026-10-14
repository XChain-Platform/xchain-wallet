// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useId, useRef } from 'react';
import { Button } from '@xchain-wallet/core/ui';
import { OverlaySurface } from './OverlaySurface.jsx';
import { useBackHandler } from '../../ui/backStack.js';
import { useFocusTrap, useInertBackground } from '../utils/focusTrap.js';

/**
 * Small centered status modal for quick "it happened" confirmations
 * (message sent, order placed, ...) where a full result screen would be
 * overkill. One title, an optional line of detail, one OK button.
 * Escape, the backdrop, and OK all dismiss it.
 *
 * @param {object} props
 * @param {string} props.title
 * @param {string} [props.message]
 * @param {string} [props.confirmLabel]  defaults to "OK"
 * @param {() => void} props.onClose
 */
export function NoticeModal({ title, message, confirmLabel = 'OK', onClose }) {
    const rootRef = useRef(null);
    const panelRef = useRef(null);
    const titleId = useId();
    const messageId = useId();
    useFocusTrap(panelRef, { active: true });
    useInertBackground(rootRef, { active: true });
    useBackHandler(onClose);
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    return (
        <OverlaySurface
            rootRef={rootRef}
            surfaceRef={panelRef}
            title={title}
            titleId={titleId}
            titleAs="p"
            aria-labelledby={titleId}
            aria-describedby={message ? messageId : undefined}
            onBackdrop={onClose}
            tabIndex={-1}
            footer={(
                <Button variant="primary" block onClick={onClose}>
                    {confirmLabel}
                </Button>
            )}
        >
            {message ? <p id={messageId}>{message}</p> : null}
        </OverlaySurface>
    );
}
