/*
 * Copyright © 2025–2026 Dankest, LLC
 * Based on XChain Platform by Dankest, LLC - https://dankest.llc
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is part of XChain Platform. Licensed under the GNU Affero
 * General Public License v3.0 or later; see LICENSE.md. A commercial
 * license (without AGPL source-disclosure terms) is available -
 * contact legal@dankest.llc.
 */

package io.xchain.wallet.android.activity;

import java.util.Arrays;
import java.util.List;
import java.util.Map;

public final class ActivityCheckResponse {

    private ActivityCheckResponse() {}

    public static List<String> strings(Object body, String confirmedPath, String pendingPath) {
        String confirmed = stringAt(body, confirmedPath);
        if (confirmed == null) {
            return null;
        }

        String pending = stringAt(body, pendingPath);
        if (pending == null) {
            return null;
        }

        return Arrays.asList(confirmed, pending);
    }

    private static String stringAt(Object body, String path) {
        if (!(body instanceof Map) || path == null || path.isEmpty()) {
            return null;
        }

        Object value = body;
        for (String segment : path.split("\\.", -1)) {
            if (segment.isEmpty() || !(value instanceof Map)) {
                return null;
            }
            value = ((Map<?, ?>) value).get(segment);
        }
        return value instanceof String ? (String) value : null;
    }
}
