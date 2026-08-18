import { afterEach, describe, expect, it, vi } from "vitest";

import { FEEDS, MAX_ENRICHED_ARTICLES } from "../src/config";
import { enrichArticleText, normalizeURL, parseFeed, stripMarkup } from "../src/feed";
import type { CandidateArticle, FeedSource } from "../src/types";

const source: FeedSource = {
  name: "Example AI",
  icon: "sparkles",
  url: "https://example.com/feed.xml",
  weight: 1.5,
  kind: "primary",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it("only enriches the top articles to preserve outbound request headroom", async () => {
    const editorialRequest = 1;
    const baseOutboundRequests = FEEDS.length + MAX_ENRICHED_ARTICLES + editorialRequest;
    expect(baseOutboundRequests).toBeLessThanOrEqual(35);

    const fetchMock = vi.fn(async () =>
      new Response("<article>A detailed article body for editorial review.</article>", {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const candidates: CandidateArticle[] = Array.from(
      { length: MAX_ENRICHED_ARTICLES + 3 },
      (_, index) => ({
        id: `article-${index}`,
        title: `Practical AI update ${index}`,
        rawSummary: "A useful AI feature is available today.",
        articleText: "",
        sourceName: "Example AI",
        sourceIcon: "sparkles",
        articleURL: `https://example.com/article-${index}`,
        publishedAt: "2026-08-14T10:00:00.000Z",
        sourceWeight: 1.5,
        sourceKind: "primary",
        heuristicScore: 90 - index,
        coverageCount: 1,
      }),
    );

    const enriched = await enrichArticleText(candidates);

    expect(fetchMock).toHaveBeenCalledTimes(MAX_ENRICHED_ARTICLES);
    expect(enriched.slice(0, MAX_ENRICHED_ARTICLES).every((article) => article.articleText)).toBe(
      true,
    );
    expect(enriched.slice(MAX_ENRICHED_ARTICLES).every((article) => !article.articleText)).toBe(
      true,
    );
    expect(enriched.map((article) => article.id)).toEqual(candidates.map((article) => article.id));
  });
});
