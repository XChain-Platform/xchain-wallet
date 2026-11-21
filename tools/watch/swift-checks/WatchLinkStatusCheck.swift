// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Darwin
import Foundation

@main
struct WatchLinkStatusCheck {
    static func main() {
        if let failure = firstFailure() {
            fputs("WatchLinkStatusCheck failed: \(failure)\n", stderr)
            exit(1)
        }
    }

    private static func firstFailure() -> String? {
        let cases: [(String, [String: Any], [String: Bool])] = [
            (
                "unsupported",
                WatchLinkStatus.dictionary(
                    supported: false,
                    activated: true,
                    paired: true,
                    installed: true,
                    reachable: true,
                    lastSyncAt: nil
                ),
                ["paired": false, "installed": false, "reachable": false]
            ),
            (
                "not activated",
                WatchLinkStatus.dictionary(
                    supported: true,
                    activated: false,
                    paired: true,
                    installed: true,
                    reachable: true,
                    lastSyncAt: nil
                ),
                ["paired": false, "installed": false, "reachable": false]
            ),
            (
                "paired, installed, and reachable",
                WatchLinkStatus.dictionary(
                    supported: true,
                    activated: true,
                    paired: true,
                    installed: true,
                    reachable: true,
                    lastSyncAt: nil
                ),
                ["paired": true, "installed": true, "reachable": true]
            ),
            (
                "installed without paired",
                WatchLinkStatus.dictionary(
                    supported: true,
                    activated: true,
                    paired: false,
                    installed: true,
                    reachable: true,
                    lastSyncAt: nil
                ),
                ["paired": false, "installed": false, "reachable": false]
            ),
            (
                "reachable without installed",
                WatchLinkStatus.dictionary(
                    supported: true,
                    activated: true,
                    paired: true,
                    installed: false,
                    reachable: true,
                    lastSyncAt: nil
                ),
                ["paired": true, "installed": false, "reachable": false]
            ),
        ]

        for (name, status, expected) in cases {
            if let failure = validate(name: name, status: status, expected: expected) {
                return failure
            }
        }

        let timestamp: Int64 = 1_700_000_000_000
        let timestampStatus = WatchLinkStatus.dictionary(
            supported: true,
            activated: true,
            paired: true,
            installed: true,
            reachable: true,
            lastSyncAt: timestamp
        )
        if timestampStatus["lastSyncAt"] as? Int64 != timestamp {
            return "valid lastSyncAt was not preserved"
        }
        if Set(timestampStatus.keys) != Set(["paired", "installed", "reachable", "lastSyncAt"]) {
            return "valid lastSyncAt produced unexpected keys"
        }

        for (name, value) in [("nil lastSyncAt", nil), ("negative lastSyncAt", Int64(-1))] {
            let status = WatchLinkStatus.dictionary(
                supported: true,
                activated: true,
                paired: true,
                installed: true,
                reachable: true,
                lastSyncAt: value
            )
            if status["lastSyncAt"] != nil {
                return "\(name) was included"
            }
            if Set(status.keys) != Set(["paired", "installed", "reachable"]) {
                return "\(name) produced unexpected keys"
            }
        }

        return nil
    }

    private static func validate(
        name: String,
        status: [String: Any],
        expected: [String: Bool]
    ) -> String? {
        if Set(status.keys) != Set(["paired", "installed", "reachable"]) {
            return "\(name) produced unexpected keys"
        }

        for key in ["paired", "installed", "reachable"] {
            if status[key] as? Bool != expected[key] {
                return "\(name) produced the wrong \(key) value"
            }
        }

        return nil
    }
}
