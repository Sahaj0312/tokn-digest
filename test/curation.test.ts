import { describe, expect, it } from "vitest";

import {
  assembleArticles,
  buildDigest,
  hasAIRelevance,
  hasPracticalSignal,
  heuristicScore,
  isBlockedStory,
} from "../src/curation";
import type { CandidateArticle, EditorialSelection } from "../src/types";

function candidate(overrides: Partial<CandidateArticle> = {}): CandidateArticle {
  return {
    id: "article-1",
    title: "ChatGPT launches a reusable workflow builder",
    rawSummary: "The feature is available today and lets users automate recurring work inside ChatGPT.",
    articleText: "",
    sourceName: "OpenAI",
    sourceIcon: "sparkles",
    articleURL: "https://openai.com/example",
    publishedAt: "2026-08-03T10:00:00.000Z",
    sourceWeight: 1.5,
    sourceKind: "primary",
    heuristicScore: 90,
    coverageCount: 1,
    ...overrides,
  };
}

describe("utility-first filtering", () => {
  it("blocks political and funding stories even when they mention AI", () => {
    expect(
      isBlockedStory(
        candidate({ title: "Congress debates a new AI regulation", rawSummary: "A political fight." }),
      ),
    ).toBe(true);
    expect(
      isBlockedStory(
        candidate({ title: "AI startup raises $40 million", rawSummary: "A funding announcement." }),
      ),
    ).toBe(true);
  });

  it("requires a concrete product, workflow, access, or how-to signal", () => {
    expect(hasPracticalSignal(candidate())).toBe(true);
    expect(
      hasPracticalSignal(
        candidate({
          title: "What intelligence means in the age of machines",
          rawSummary: "An abstract essay about society and technology.",
        }),
      ),
    ).toBe(false);
  });

  it("rejects ordinary software updates that are not meaningfully about AI", () => {
    expect(
      hasAIRelevance(
        candidate({
          title: "Google Meet now includes screenshots in meeting notes",
          rawSummary: "The update is available to Workspace users today.",
        }),
      ),
    ).toBe(false);
    expect(hasAIRelevance(candidate())).toBe(true);
  });

  it("gives primary, recent, actionable stories a strong score", () => {
    const score = heuristicScore(candidate(), new Date("2026-08-03T12:00:00.000Z"));
    expect(score).toBeGreaterThanOrEqual(80);
  });
});

describe("digest quality gates", () => {
  it("caps one source at two stories and preserves candidate URLs", () => {
    const candidates = [
      candidate({ id: "one", articleURL: "https://openai.com/one" }),
      candidate({ id: "two", articleURL: "https://openai.com/two" }),
      candidate({ id: "three", articleURL: "https://openai.com/three" }),
      candidate({ id: "four", sourceName: "Google AI", articleURL: "https://blog.google/four" }),
    ];
    const selections: EditorialSelection[] = candidates.map((article, index) => ({
      id: article.id,
      title: `Useful AI product update number ${index + 1}`,
      summary:
        "A practical AI feature is now available to everyday users. It can reduce repetitive work in a concrete workflow.",
      category: "product",
      relevanceScore: 95 - index,
    }));

    const result = assembleArticles(candidates, selections);
    expect(result).toHaveLength(3);
    expect(result.filter((article) => article.sourceName === "OpenAI")).toHaveLength(2);
    expect(result.at(-1)?.articleURL).toBe("https://blog.google/four");
  });

  it("keeps the app's existing JSON contract", () => {
    const articles = assembleArticles(
      [
        candidate({ id: "one" }),
        candidate({ id: "two", sourceName: "Google AI" }),
        candidate({ id: "three", sourceName: "Microsoft AI" }),
      ],
      ["one", "two", "three"].map((id) => ({
        id,
        title: "A useful AI feature is now available",
        summary:
          "A broadly available product gained a concrete new capability. Readers can use it today in a practical workflow.",
        category: "product" as const,
        relevanceScore: 90,
      })),
    );
    const digest = buildDigest(articles, new Date("2026-08-03T18:50:00.000Z"), "pm", {
      feedsAttempted: 10,
      feedsSucceeded: 9,
      articlesProcessed: 42,
    });

    expect(digest.digestDate).toBe("2026-08-03");
    expect(digest.digestSlot).toBe("pm");
    expect(digest.headline?.id).toBe("one");
    expect(digest.articles).toHaveLength(2);
    expect(digest.metadata.articlesSelected).toBe(3);
  });
});
