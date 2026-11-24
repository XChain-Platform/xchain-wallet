import XCTest

enum WatchSettingsNav {
    @discardableResult
    static func open(
        _ app: XCUIApplication,
        timeout: TimeInterval = 30
    ) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        let settings = button(app, label: "Settings", comparison: "CONTAINS[c]")
        let more = button(app, label: "More", comparison: "CONTAINS[c]")

        guard waitUntil(deadline: deadline, condition: {
            (settings.exists && settings.isHittable)
                || (more.exists && more.isHittable)
        }) else {
            return failed("Settings or More from the home screen", app: app)
        }

        if settings.exists && settings.isHittable {
            settings.tap()
        } else {
            guard more.exists && more.isHittable else {
                return failed("More from the home screen", app: app)
            }
            more.tap()
            guard waitUntilHittable(settings, deadline: deadline) else {
                return failed("Settings in the More sheet", app: app)
            }
            settings.tap()
        }

        let watch = button(app, label: "Watch", comparison: "BEGINSWITH[c]")
        var swipes = 0
        while !isHittable(watch) && swipes < 5 && Date() < deadline {
            app.swipeUp()
            swipes += 1
        }
        guard waitUntilHittable(watch, deadline: deadline) else {
            return failed("Watch in Settings", app: app)
        }
        watch.tap()

        let rows = ["Paired", "Installed", "Reachable", "Last sync"].map {
            (title: $0, element: element(app, label: $0, comparison: "CONTAINS[c]"))
        }
        let sendTestAlert = button(
            app,
            label: "Send Test Alert",
            comparison: "CONTAINS[c]"
        )
        guard waitUntil(deadline: deadline, condition: {
            rows.allSatisfy { $0.element.exists } && sendTestAlert.exists
        }) else {
            if let missing = rows.first(where: { !$0.element.exists }) {
                return failed("\(missing.title) in Watch Settings", app: app)
            }
            return failed("Send Test Alert in Watch Settings", app: app)
        }
        return true
    }

    private static func button(
        _ app: XCUIApplication,
        label: String,
        comparison: String
    ) -> XCUIElement {
        app.buttons.matching(
            NSPredicate(format: "label \(comparison) %@", label)
        ).firstMatch
    }

    private static func element(
        _ app: XCUIApplication,
        label: String,
        comparison: String
    ) -> XCUIElement {
        app.descendants(matching: .any).matching(
            NSPredicate(format: "label \(comparison) %@", label)
        ).firstMatch
    }

    private static func isHittable(_ element: XCUIElement) -> Bool {
        element.exists && element.isHittable
    }

    private static func waitUntilHittable(
        _ element: XCUIElement,
        deadline: Date
    ) -> Bool {
        waitUntil(deadline: deadline) { isHittable(element) }
    }

    private static func waitUntil(
        deadline: Date,
        condition: () -> Bool
    ) -> Bool {
        repeat {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        } while Date() < deadline
        return condition()
    }

    private static func failed(_ step: String, app: XCUIApplication) -> Bool {
        XCTContext.runActivity(named: "Watch Settings navigation could not reach: \(step)") { _ in
            XCTContext.runActivity(named: app.debugDescription) { _ in }
        }
        return false
    }
}
