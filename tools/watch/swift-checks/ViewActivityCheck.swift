// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Darwin
import Foundation

@main
struct ViewActivityCheck {
    static func main() {
        if let failure = firstFailure() {
            fputs("ViewActivityCheck failed: \(failure)\n", stderr)
            exit(1)
        }
    }

    private static func firstFailure() -> String? {
        guard ViewActivity.activityType == "io.xchain.wallet.view" else {
            return "watch activityType"
        }
        guard WatchViewActivity.activityType == "io.xchain.wallet.view" else {
            return "phone activityType"
        }
        guard ViewActivity.routeKey == "route" else {
            return "watch routeKey"
        }
        guard WatchViewActivity.routeKey == "route" else {
            return "phone routeKey"
        }

        let routes = [
            "/",
            "/token/BTC",
            String(repeating: "r", count: 300),
        ]
        for route in routes {
            let userInfo = ViewActivity.userInfo(
                for: OpenOnPhoneIntent(route: route)
            )
            guard WatchViewActivity.route(
                activityType: ViewActivity.activityType,
                userInfo: userInfo
            ) == route else {
                return "round trip for \(route.count)-character route"
            }
        }

        guard ViewActivity.userInfo(for: OpenOnPhoneIntent(route: "")) == nil else {
            return "empty watch route"
        }

        let validUserInfo: [AnyHashable: Any] = ["route": "/"]
        let invalidCases: [(String, String, [AnyHashable: Any]?)] = [
            ("different activity type", "io.xchain.wallet.view.other", validUserInfo),
            ("empty activity type", "", validUserInfo),
            ("browsing web activity type", NSUserActivityTypeBrowsingWeb, validUserInfo),
            ("nil userInfo", WatchViewActivity.activityType, nil),
            ("empty userInfo", WatchViewActivity.activityType, [:]),
            ("numeric route", WatchViewActivity.activityType, ["route": 1]),
            ("empty string route", WatchViewActivity.activityType, ["route": ""]),
            (
                "route with second key",
                WatchViewActivity.activityType,
                ["route": "/", "other": true]
            ),
        ]

        for (name, activityType, userInfo) in invalidCases {
            guard WatchViewActivity.route(
                activityType: activityType,
                userInfo: userInfo
            ) == nil else {
                return name
            }
        }

        return nil
    }
}
