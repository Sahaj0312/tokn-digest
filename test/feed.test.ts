import { describe, expect, it } from "vitest";

import { normalizeURL, parseFeed, stripMarkup } from "../src/feed";
import type { FeedSource } from "../src/types";

const source: FeedSource = {
  name: "Example AI",
  icon: "sparkles",
  url: "https://example.com/feed.xml",
  weight: 1.5,
  kind: "primary",
};

describe("feed parsing", () => {
  it("parses RSS entries and discards stale entries", async () => {
    const xml = `<?xml version="1.0"?>
      <rss><channel>
        <item>
          <title>New practical AI feature</title>
          <link>https://example.com/new?utm_source=rss</link>
          <pubDate>Mon, 03 Aug 2026 10:00:00 GMT</pubDate>
          <description><![CDATA[<p>A useful feature is available today.</p>]]></description>
        </item>
        <item>
          <title>Old story</title>
          <link>https://example.com/old</link>
          <pubDate>Mon, 20 Jul 2026 10:00:00 GMT</pubDate>
        </item>
      </channel></rss>`;

    const articles = await parseFeed(xml, source, new Date("2026-08-03T12:00:00.000Z"));
    expect(articles).toHaveLength(1);
    expect(articles[0].title).toBe("New practical AI feature");
    expect(articles[0].rawSummary).toBe("A useful feature is available today.");
  });

  it("normalizes tracking parameters and markup", () => {
    expect(normalizeURL("https://www.example.com/post/?utm_source=x&ref=home")).toBe(
      "https://example.com/post",
    );
    expect(stripMarkup("<p>Hello&nbsp;<strong>world</strong></p>")).toBe("Hello world");
  });
});
