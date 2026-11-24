/*
 * Copyright © 2025–2026 Dankest, LLC
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import Foundation

@main
struct BrowserReturnHintCheck {

    private static var passed = 0

    static func main() {
        let https = "https://example.com/cb?x=1#r=a%2Bb&s=1"

        check("chrome candidates", strings(https, "chrome") == [
            "googlechromes://example.com/cb?x=1#r=a%2Bb&s=1",
            https,
        ])
        check("edge candidates", strings(https, "edge") == [
            "microsoft-edge-https://example.com/cb?x=1#r=a%2Bb&s=1",
            https,
        ])

        let firefox = BrowserReturnHint.candidates(url: https, browser: "firefox")
        check("firefox candidate count", firefox.count == 2)
        if firefox.count == 2 {
            let raw = firefox[0].absoluteString
            let decoded = URLComponents(url: firefox[0], resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "url" })?.value
            check("firefox decoded URL", decoded == https)
            check("firefox raw delimiters", !raw.contains("#") && !raw.contains("&"))
            check("firefox fallback", firefox[1].absoluteString == https)
        }

        check("uppercase HTTPS", strings("HTTPS://example.com/cb", "chrome") == [
            "googlechromes://example.com/cb",
            "HTTPS://example.com/cb",
        ])

        for browser in ["safari", "samsung", "", "Chrome", "opera"] {
            check("single candidate for \(browser)", strings(https, browser) == [https])
        }
        check("single candidate for nil", strings(https, nil) == [https])

        let invalidURLs = [
            "http://example.com/cb",
            "xchain://request",
            "https:///cb",
            "https://u:p@example.com/cb",
            "not a url",
        ]
        for url in invalidURLs {
            check("invalid URL \(url)", BrowserReturnHint.candidates(url: url, browser: "chrome").isEmpty)
        }

        print("BrowserReturnHintCheck: \(passed) passed, 0 failed")
    }

    private static func strings(_ url: String, _ browser: String?) -> [String] {
        BrowserReturnHint.candidates(url: url, browser: browser).map(\.absoluteString)
    }

    private static func check(_ name: String, _ condition: Bool) {
        guard condition else {
            FileHandle.standardError.write(Data("FAILED: \(name)\n".utf8))
            exit(1)
        }
        passed += 1
    }
}
