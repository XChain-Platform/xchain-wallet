import Foundation

@main
enum ActivityCheckSessionCheck {
    static func main() {
        check(
            "task identifier",
            ActivityCheckSession.taskIdentifier == "io.xchain.wallet.ios.activity-check"
        )
        check("repeat interval", ActivityCheckSession.repeatInterval == 21_600)

        let now = Date(timeIntervalSince1970: 1_700_000_000)
        check(
            "earliest begin date",
            ActivityCheckSession.earliestBeginDate(after: now).timeIntervalSince1970
                == 1_700_021_600
        )

        checkConfiguration(
            ActivityCheckSession.configuration(),
            name: "configuration"
        )
        checkConfiguration(
            ActivityCheckSession.makeSession().configuration,
            name: "made session configuration"
        )

        checkRequest(
            "https://explorer.xchain.io/BTC/api/address/<address>",
            name: "https target"
        )
        checkRequest(
            "http://127.0.0.1:3000/address/<address>",
            name: "regtest target"
        )

        for invalidURL in [
            "",
            "not a url",
            "file:///etc/hosts",
            "ftp://example.com/a",
            "https:///address/x",
        ] {
            check(
                "invalid target \(invalidURL)",
                ActivityCheckSession.request(url: invalidURL) == nil
            )
        }

        let responseURL = URL(string: "https://example.com/address/x")!
        let data = Data("body".utf8)
        let ok = HTTPURLResponse(
            url: responseURL,
            statusCode: 200,
            httpVersion: nil,
            headerFields: nil
        )!
        let notFound = HTTPURLResponse(
            url: responseURL,
            statusCode: 404,
            httpVersion: nil,
            headerFields: nil
        )!
        let plain = URLResponse(
            url: responseURL,
            mimeType: nil,
            expectedContentLength: data.count,
            textEncodingName: nil
        )
        let error = NSError(domain: "ActivityCheckSessionCheck", code: 1)

        check(
            "200 body",
            ActivityCheckSession.body(data: data, response: ok, error: nil) == data
        )
        check(
            "404 body",
            ActivityCheckSession.body(data: data, response: notFound, error: nil) == nil
        )
        check(
            "200 error",
            ActivityCheckSession.body(data: data, response: ok, error: error) == nil
        )
        check(
            "nil data",
            ActivityCheckSession.body(data: nil, response: ok, error: nil) == nil
        )
        check(
            "plain response",
            ActivityCheckSession.body(data: data, response: plain, error: nil) == nil
        )
    }

    private static func checkConfiguration(
        _ configuration: URLSessionConfiguration,
        name: String
    ) {
        check(
            name,
            configuration.requestCachePolicy == .reloadIgnoringLocalCacheData
                && configuration.timeoutIntervalForRequest == 10
                && configuration.timeoutIntervalForResource == 10
        )
    }

    private static func checkRequest(_ target: String, name: String) {
        let request = ActivityCheckSession.request(url: target)
        check(
            name,
            request?.url == URL(string: target)
                && request?.httpMethod == "GET"
                && request?.timeoutInterval == 10
                && request?.cachePolicy == .reloadIgnoringLocalCacheData
        )
    }

    private static func check(_ name: String, _ passed: @autoclosure () -> Bool) {
        guard passed() else {
            print("FAIL: \(name)")
            Foundation.exit(1)
        }
    }
}
