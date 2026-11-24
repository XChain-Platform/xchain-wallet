// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation
import UserNotifications

@main
struct NotifyPermissionCheck {
    static func main() {
        check("not determined state", NotifyPermission.state(.notDetermined) == "prompt")
        check("provisional state", NotifyPermission.state(.provisional) == "prompt")
        check("denied state", NotifyPermission.state(.denied) == "denied")
        check("authorized state", NotifyPermission.state(.authorized) == "granted")

        let reply = NotifyPermission.reply(.denied)
        check(
            "denied reply",
            reply.count == 1 && reply["state"] as? String == "denied"
        )

        let options = NotifyPermission.requestOptions
        check("alert request option", options.contains(.alert))
        check("sound request option", options.contains(.sound))
        check("no badge request option", !options.contains(.badge))
        check("no provisional request option", !options.contains(.provisional))
    }

    private static func check(_ name: String, _ condition: @autoclosure () -> Bool) {
        guard condition() else {
            FileHandle.standardError.write(Data("failed: \(name)\n".utf8))
            exit(1)
        }
    }
}
