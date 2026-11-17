// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The one-line step status the connect flow (Plugged in, Unlock, Allow
// XChain) and the sign page (Device, Unlock, Confirm, Signed) share: a
// circle per step joined by a line, a green check when done, a red X when
// it failed, a ring while it runs, and the step's name under its circle.
// Each step also says its state in words for assistive tech.

import { CheckIcon, XIcon } from '../../../ui/icons/index.jsx';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/hardwareConnect.js';
import styles from './HardwareStatusLine.module.css';

const STATE_KEY = {
    done: 'hardwareConnect.statusLine.done',
    active: 'hardwareConnect.statusLine.active',
    todo: 'hardwareConnect.statusLine.todo',
    failed: 'hardwareConnect.statusLine.failed',
};

/**
 * @param {{steps: Array<{label: string, state: 'done'|'active'|'todo'|'failed'}>,
 *   label?: string}} props
 *   `label` names the list for assistive tech; it defaults to "Progress".
 */
export function HardwareStatusLine({ steps, label }) {
    return (
        <ol className={styles.line} aria-label={label || t('hardwareConnect.statusLine.label')} data-hardware-status-line="">
            {steps.map((step) => {
                const state = STATE_KEY[step.state] ? step.state : 'todo';
                return (
                    <li
                        key={step.label}
                        className={styles.step}
                        data-state={state}
                        aria-current={state === 'active' ? 'step' : undefined}
                    >
                        <span className={styles.marker} aria-hidden="true">
                            {state === 'done' ? <CheckIcon /> : null}
                            {state === 'failed' ? <XIcon /> : null}
                        </span>
                        <span className={styles.label} aria-hidden="true">{step.label}</span>
                        <span className={styles.visuallyHidden}>
                            {t(STATE_KEY[state], { label: step.label })}
                        </span>
                    </li>
                );
            })}
        </ol>
    );
}
