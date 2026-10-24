// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useState } from 'react';
import { useMessaging } from '../useMessaging.js';
import { loadSupportedAddressTypes } from '../utils/supportedAddressTypes.js';

// The address types a picker offers for `descriptor`. Starts with the registry
// list and narrows once the host reports what the SDK can generate.
/**
 * @param {{ id: string, addressTypes: string[] }|null|undefined} descriptor
 * @returns {string[]}
 */
export function useSupportedAddressTypes(descriptor) {
    const { messaging } = useMessaging();
    const id = descriptor?.id;
    const registryTypes = descriptor?.addressTypes;
    const [state, setState] = useState(/** @type {{ id?: string, types?: string[] }} */ ({}));
    useEffect(() => {
        let live = true;
        if (!id) return undefined;
        loadSupportedAddressTypes(messaging, { id, addressTypes: registryTypes || [] }).then((types) => {
            if (live) setState({ id, types });
        });
        return () => { live = false; };
    }, [messaging, id, registryTypes]);
    return state.id === id && state.types ? state.types : (registryTypes || []);
}
