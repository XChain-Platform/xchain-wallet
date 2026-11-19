// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import styles from './Input.module.css';
import { t } from '../i18n/index.js';
import '../i18n/locales/en/ui.js';

/** The shared state marker for a field that accepts an empty value. */
export function OptionalPill({ id, className }) {
    return (
        <span
            id={id}
            className={[styles.optionalPill, className].filter(Boolean).join(' ')}
            data-optional-pill
        >
            {t('ui.field.optional')}
        </span>
    );
}
