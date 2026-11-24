// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation
import UserNotifications

@main
struct NotifyContentCheck {
    static func main() {
        let namedArgs = parse([
            "id": "req-1",
            "title": "Payment due",
            "body": "Open XChain Wallet",
            "family": "paydue",
            "sound": "chime",
            "category": "paydue",
        ], caseName: "named sound args parse")
        let namedContent = NotifyContent.content(namedArgs)
        check(namedContent.title == "Payment due", "named sound title")
        check(namedContent.body == "Open XChain Wallet", "named sound body")
        check(namedContent.threadIdentifier == "paydue", "named sound thread identifier")
        check(namedContent.categoryIdentifier == "paydue", "named sound category identifier")
        check(
            namedContent.sound?.isEqual(
                UNNotificationSound(
                    named: UNNotificationSoundName(rawValue: "chime.caf")
                )
            ) == true,
            "named sound"
        )

        let silentArgs = parse([
            "id": "silent",
            "title": "Silent",
            "family": "alert",
            "sound": "none",
        ], caseName: "silent args parse")
        check(NotifyContent.content(silentArgs).sound == nil, "silent sound")

        let defaultArgs = parse([
            "id": "default",
            "title": "Default",
            "family": "alert",
        ], caseName: "default sound args parse")
        check(
            NotifyContent.content(defaultArgs).sound?.isEqual(UNNotificationSound.default) == true,
            "default sound"
        )

        let noCategoryContent = NotifyContent.content(defaultArgs)
        check(noCategoryContent.categoryIdentifier.isEmpty, "missing category")

        let threadedArgs = parse([
            "id": "threaded",
            "title": "Threaded",
            "family": "alert",
            "threadId": "t-9",
        ], caseName: "threaded args parse")
        check(
            NotifyContent.content(threadedArgs).threadIdentifier == "t-9",
            "explicit thread identifier"
        )

        let immediateRequest = NotifyContent.request(namedArgs, trigger: nil)
        check(immediateRequest.identifier == "req-1", "nil trigger request identifier")
        check(immediateRequest.trigger == nil, "nil trigger request trigger")
        check(immediateRequest.content.title == "Payment due", "nil trigger request title")

        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 5, repeats: false)
        let scheduledRequest = NotifyContent.request(namedArgs, trigger: trigger)
        guard let keptTrigger = scheduledRequest.trigger as? UNTimeIntervalNotificationTrigger else {
            fail("time interval request trigger type")
        }
        check(keptTrigger.timeInterval == 5, "time interval request trigger value")
    }

    private static func parse(
        _ values: [String: Any],
        caseName: String
    ) -> NotifyPostArgs {
        guard let args = NotifyPostArgs.parse(values) else {
            fail(caseName)
        }
        return args
    }

    private static func check(_ condition: @autoclosure () -> Bool, _ name: String) {
        guard condition() else {
            fail(name)
        }
    }

    private static func fail(_ name: String) -> Never {
        FileHandle.standardError.write(Data("FAILED: \(name)\n".utf8))
        exit(1)
    }
}
