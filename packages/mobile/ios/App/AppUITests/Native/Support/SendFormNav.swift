import XCTest

enum SendFormNav {
    @discardableResult
    static func open(
        _ app: XCUIApplication,
        timeout: TimeInterval = 30
    ) -> Bool {
        guard app.webViews.firstMatch.waitForExistence(timeout: timeout) else {
            return failed("Send page", app: app)
        }

        let send = app.buttons.matching(
            NSPredicate(format: "label ==[c] %@", "Send")
        ).firstMatch
        guard waitUntil(timeout: timeout, condition: {
            send.exists && send.isEnabled
        }) else {
            return failed("Send button", app: app)
        }
        tap(send)

        guard waitUntil(timeout: timeout, condition: {
            field(app, hints: ["address or name"])?.exists == true
        }) else {
            return failed("To field", app: app)
        }
        return true
    }

    static func fill(
        _ app: XCUIApplication,
        to: String,
        amount: String,
        timeout: TimeInterval = 30
    ) -> Bool {
        guard fillField(
            app,
            name: "To field",
            hints: ["address or name"],
            value: to,
            timeout: timeout
        ) else {
            return false
        }
        guard fillField(
            app,
            name: "Amount field",
            hints: ["Amount", "0.00"],
            value: amount,
            timeout: timeout
        ) else {
            return false
        }

        let hide = app.keyboards.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] %@", "hide")
        ).firstMatch
        if hide.exists && hide.isHittable {
            hide.tap()
        }
        return true
    }

    static func fieldValues(_ app: XCUIApplication) -> [String: String] {
        var values: [String: String] = [:]
        if let value = enteredValue(field(app, hints: ["address or name"])) {
            values["to"] = value
        }
        if let value = enteredValue(field(app, hints: ["Amount", "0.00"])) {
            values["amount"] = value
        }
        return values
    }

    private static func fillField(
        _ app: XCUIApplication,
        name: String,
        hints: [String],
        value: String,
        timeout: TimeInterval
    ) -> Bool {
        guard dismissKeyboard(app) else {
            return failed("\(name) keyboard dismissal", app: app)
        }
        guard waitUntil(timeout: timeout, condition: {
            field(app, hints: hints)?.exists == true
        }) else {
            return failed(name, app: app)
        }
        guard focus(app, hints: hints) else {
            return failed(name, app: app)
        }
        app.typeText(value)
        return true
    }

    private static func field(
        _ app: XCUIApplication,
        hints: [String]
    ) -> XCUIElement? {
        if hints.contains("address or name") {
            let recipient = app.textFields.matching(
                NSPredicate(
                    format: "label CONTAINS[c] %@ OR placeholderValue BEGINSWITH[c] %@",
                    "address or name",
                    "Enter an address"
                )
            ).firstMatch
            if recipient.exists {
                return recipient
            }
        }
        for hint in hints {
            let predicate = NSPredicate(
                format: "label CONTAINS[c] %@ OR placeholderValue CONTAINS[c] %@",
                hint,
                hint
            )
            let match = app.textFields.matching(predicate).firstMatch
            if match.exists {
                return match
            }
        }
        return nil
    }

    private static func enteredValue(_ element: XCUIElement?) -> String? {
        guard
            let element,
            element.exists,
            let value = element.value as? String,
            value != element.placeholderValue
        else {
            return nil
        }
        return value
    }

    private static func focus(
        _ app: XCUIApplication,
        hints: [String]
    ) -> Bool {
        let window = app.windows.firstMatch
        for attempt in 0...8 {
            if let control = field(app, hints: hints),
               control.exists,
               control.isEnabled,
               control.isHittable,
               window.exists,
               window.frame.contains(control.frame) {
                control.tap()
                if waitUntil(timeout: 5, condition: {
                    guard let current = field(app, hints: hints) else {
                        return false
                    }
                    return hasKeyboardFocus(current)
                }) {
                    return true
                }

                guard let current = field(app, hints: hints),
                      current.exists,
                      current.isEnabled,
                      current.isHittable,
                      window.frame.contains(current.frame)
                else {
                    continue
                }
                current.tap()
                if waitUntil(timeout: 5, condition: {
                    guard let refreshed = field(app, hints: hints) else {
                        return false
                    }
                    return hasKeyboardFocus(refreshed)
                }) {
                    return true
                }
            }
            if attempt == 8 { break }
            guard let control = field(app, hints: hints), control.exists else {
                return false
            }
            if window.exists && control.frame.minY < window.frame.minY {
                swipePage(app, direction: .down)
            } else {
                swipePage(app, direction: .up)
            }
        }
        return false
    }

    private static func tap(_ element: XCUIElement) {
        if element.isHittable && element.isEnabled {
            element.tap()
        } else {
            element.coordinate(
                withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)
            ).tap()
        }
    }

    private static func hasKeyboardFocus(_ element: XCUIElement) -> Bool {
        element.exists && (element.value(forKey: "hasKeyboardFocus") as? Bool == true)
    }

    private static func dismissKeyboard(_ app: XCUIApplication) -> Bool {
        if app.keyboards.count == 0 { return true }

        let dismiss = app.keyboards.buttons.matching(
            NSPredicate(
                format: "label CONTAINS[c] %@ OR label ==[c] %@ OR label ==[c] %@",
                "hide",
                "Done",
                "Return"
            )
        ).firstMatch
        if dismiss.exists && dismiss.isHittable {
            dismiss.tap()
            if waitUntil(timeout: 5, condition: { app.keyboards.count == 0 }) {
                return true
            }
        }

        let window = app.windows.firstMatch
        if window.exists {
            window.coordinate(
                withNormalizedOffset: CGVector(dx: 0.5, dy: 0.075)
            ).tap()
        }
        return waitUntil(timeout: 5) { app.keyboards.count == 0 }
    }

    private enum SwipeDirection {
        case up
        case down
    }

    private static func swipePage(
        _ app: XCUIApplication,
        direction: SwipeDirection
    ) {
        let page = app.webViews.firstMatch
        let target = page.exists ? page : app
        switch direction {
        case .up:
            target.swipeUp()
        case .down:
            target.swipeDown()
        }
    }

    private static func waitUntil(
        timeout: TimeInterval,
        condition: () -> Bool
    ) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        } while Date() < deadline
        return condition()
    }

    private static func failed(_ name: String, app: XCUIApplication) -> Bool {
        XCTContext.runActivity(named: "Send form could not reach: \(name)") { _ in
            XCTContext.runActivity(named: app.debugDescription) { _ in }
        }
        return false
    }
}
