// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import Darwin
import Foundation

@main
struct CallbackSessionCheck {
    private static var passed = 0

    private static func check(_ condition: @autoclosure () -> Bool, _ name: String) {
        guard condition() else {
            FileHandle.standardError.write(Data("FAIL: \(name)\n".utf8))
            Darwin.exit(1)
        }
        passed += 1
    }

    static func main() {
        let configuration = CallbackSession.configuration()
        check(configuration.httpCookieStorage == nil, "configuration cookie storage")
        check(configuration.urlCache == nil, "configuration URL cache")
        check(configuration.urlCredentialStorage == nil, "configuration credential storage")
        check(!configuration.httpShouldSetCookies, "configuration cookie handling")
        check(configuration.httpCookieAcceptPolicy == .never, "configuration cookie policy")
        check(
            configuration.requestCachePolicy == .reloadIgnoringLocalCacheData,
            "configuration cache policy"
        )
        check(configuration.timeoutIntervalForRequest == 10, "configuration request timeout")
        check(configuration.timeoutIntervalForResource == 10, "configuration resource timeout")

        let body = #"{"message":"café"}"#
        let expectedBody = Data(body.utf8)
        guard let request = CallbackSession.request(
            href: "https://example.com/cb",
            body: body,
            developerMode: false
        ) else {
            check(false, "HTTPS request creation")
            return
        }
        check(request.httpMethod == "POST", "request method")
        check(request.value(forHTTPHeaderField: "Content-Type") == "application/json", "request content type")
        check(request.httpBody == expectedBody, "request UTF-8 body")
        check(!request.httpShouldHandleCookies, "request cookie handling")
        check(request.timeoutInterval == 10, "request timeout")
        check(request.cachePolicy == .reloadIgnoringLocalCacheData, "request cache policy")

        check(
            CallbackSession.request(
                href: "http://example.com/cb",
                body: "{}",
                developerMode: true
            ) == nil,
            "non-loopback HTTP rejection"
        )
        check(
            CallbackSession.request(
                href: "https://example.com/#x",
                body: "{}",
                developerMode: false
            ) == nil,
            "fragment rejection"
        )
        check(
            CallbackSession.request(
                href: "https://example.com/cb",
                body: String(repeating: "a", count: 10_241),
                developerMode: false
            ) == nil,
            "oversized body rejection"
        )
        check(
            CallbackSession.request(
                href: "http://localhost:8080/cb",
                body: "{}",
                developerMode: false
            ) == nil,
            "loopback HTTP production rejection"
        )
        check(
            CallbackSession.request(
                href: "http://localhost:8080/cb",
                body: "{}",
                developerMode: true
            ) != nil,
            "loopback HTTP developer acceptance"
        )

        let session = CallbackSession.makeSession()
        check(session.delegate is CallbackRedirectRefuser, "session redirect delegate")

        let task = session.dataTask(with: URL(string: "https://example.com/cb")!)
        let response = HTTPURLResponse(
            url: URL(string: "https://example.com/cb")!,
            statusCode: 302,
            httpVersion: nil,
            headerFields: ["Location": "https://example.com/other"]
        )!
        var completionCalls = 0
        var redirectedRequest: URLRequest?
        (session.delegate as! CallbackRedirectRefuser).urlSession(
            session,
            task: task,
            willPerformHTTPRedirection: response,
            newRequest: URLRequest(url: URL(string: "https://example.com/other")!)
        ) { request in
            completionCalls += 1
            redirectedRequest = request
        }
        check(completionCalls == 1, "redirect completion count")
        check(redirectedRequest == nil, "redirect refusal")
        task.cancel()
        session.invalidateAndCancel()

        print("PASS: CallbackSessionCheck (\(passed) checks)")
    }
}
