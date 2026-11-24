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

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

public final class ActivityCheckConfig {

    public final boolean enabled;
    public final List<Target> targets;
    public final String noticeTitle;
    public final String noticeBody;
    public final String openOnPhoneTitle;

    private ActivityCheckConfig(
            boolean enabled,
            List<Target> targets,
            String noticeTitle,
            String noticeBody,
            String openOnPhoneTitle) {
        this.enabled = enabled;
        this.targets = Collections.unmodifiableList(new ArrayList<>(targets));
        this.noticeTitle = noticeTitle;
        this.noticeBody = noticeBody;
        this.openOnPhoneTitle = openOnPhoneTitle;
    }

    public static ActivityCheckConfig fromTree(Object tree) {
        if (!(tree instanceof Map)) {
            return null;
        }

        Map<?, ?> config = (Map<?, ?>) tree;
        List<Target> targets = new ArrayList<>();
        Object targetValues = config.get("targets");
        if (targetValues instanceof List) {
            for (Object value : (List<?>) targetValues) {
                Target target = Target.fromTree(value);
                if (target != null) {
                    targets.add(target);
                }
            }
        }

        String noticeTitle = null;
        String noticeBody = null;
        Object noticeValue = config.get("notice");
        if (noticeValue instanceof Map) {
            Map<?, ?> notice = (Map<?, ?>) noticeValue;
            noticeTitle = nonBlankString(notice.get("title"));
            noticeBody = nonBlankString(notice.get("body"));
        }

        return new ActivityCheckConfig(
                Boolean.TRUE.equals(config.get("enabled")),
                targets,
                noticeTitle,
                noticeBody,
                nonBlankString(config.get("openOnPhoneTitle")));
    }

    public boolean isRunnable() {
        return enabled && !targets.isEmpty();
    }

    public List<String> addresses() {
        List<String> addresses = new ArrayList<>(targets.size());
        for (Target target : targets) {
            addresses.add(target.address);
        }
        return addresses;
    }

    private static String nonBlankString(Object value) {
        if (!(value instanceof String)) {
            return null;
        }
        String string = (String) value;
        return string.trim().isEmpty() ? null : string;
    }

    public static final class Target {

        public final String address;
        public final String url;
        public final String confirmedPath;
        public final String pendingPath;
        public final String confirmed;
        public final String pending;

        private Target(
                String address,
                String url,
                String confirmedPath,
                String pendingPath,
                String confirmed,
                String pending) {
            this.address = address;
            this.url = url;
            this.confirmedPath = confirmedPath;
            this.pendingPath = pendingPath;
            this.confirmed = confirmed;
            this.pending = pending;
        }

        private static Target fromTree(Object tree) {
            if (!(tree instanceof Map)) {
                return null;
            }

            Map<?, ?> target = (Map<?, ?>) tree;
            String address = nonEmptyString(target.get("address"));
            String url = nonEmptyString(target.get("url"));
            String confirmedPath = nonEmptyString(target.get("confirmedPath"));
            String pendingPath = nonEmptyString(target.get("pendingPath"));
            if (address == null || url == null || confirmedPath == null || pendingPath == null) {
                return null;
            }

            return new Target(
                    address,
                    url,
                    confirmedPath,
                    pendingPath,
                    stringOrNull(target.get("confirmed")),
                    stringOrNull(target.get("pending")));
        }

        private static String nonEmptyString(Object value) {
            return value instanceof String && !((String) value).isEmpty() ? (String) value : null;
        }

        private static String stringOrNull(Object value) {
            return value instanceof String ? (String) value : null;
        }
    }
}
