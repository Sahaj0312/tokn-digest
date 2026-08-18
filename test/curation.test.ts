import { describe, expect, it } from "vitest";

import {
  assembleArticles,
  buildDigest,
  hasAIRelevance,
  hasPracticalSignal,
  heuristicScore,
  isBlockedStory,
  parseEditorialResponse,
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
    expect(
      isBlockedStory(
        candidate({
          title: "Apple reportedly considers paid AI upgrades",
          rawSummary: "The unconfirmed feature could arrive next year.",
        }),
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
  it("rejects editorial output that omits a required localization", () => {
    const rankedSelections = Array.from({ length: 10 }, (_, index) => ({
      id: `localized-${index}`,
      localizations: {
        en: {
          title: `Useful localized AI update number ${index + 1}`,
          summary:
            "A practical AI feature is now available to everyday users. It can reduce repetitive work in a concrete workflow.",
        },
        de: {
          title: `Nützliches lokalisiertes KI-Update Nummer ${index + 1}`,
          summary:
            "Eine praktische KI-Funktion ist jetzt für alltägliche Nutzer verfügbar. Sie kann wiederkehrende Arbeit in einem konkreten Ablauf reduzieren.",
        },
      },
      category: "product",
      relevanceScore: 90,
    }));
    delete (rankedSelections[0].localizations as Partial<typeof rankedSelections[0]["localizations"]>)
      .de;

    expect(() => parseEditorialResponse(JSON.stringify({ rankedSelections }))).toThrow(
      "runtime validation",
    );
  });

  it("requires at least ten stories and caps one source at two", () => {
    const sourceNames = [
      "OpenAI",
      "Google AI",
      "Microsoft AI",
      "ZDNET",
      "Tom's Guide",
      "TechRepublic",
    ];
    const candidates = Array.from({ length: 13 }, (_, index) => {
      const sourceName = sourceNames[Math.min(Math.floor(index / 2), sourceNames.length - 1)];
      return candidate({
        id: `article-${index}`,
        sourceName,
        articleURL: `https://example.com/article-${index}`,
      });
    });
    const selections: EditorialSelection[] = candidates.map((article, index) => ({
      id: article.id,
      localizations: {
        en: {
          title: `Useful AI product update number ${index + 1}`,
          summary:
            "A practical AI feature is now available to everyday users. It can reduce repetitive work in a concrete workflow.",
        },
        de: {
          title: `Nützliches KI-Produktupdate Nummer ${index + 1}`,
          summary:
            "Eine praktische KI-Funktion ist jetzt für alltägliche Nutzer verfügbar. Sie kann wiederkehrende Arbeit in einem konkreten Ablauf reduzieren.",
        },
      },
      category: "product",
      relevanceScore: 95 - index,
    }));

    const result = assembleArticles(candidates, selections);
    expect(result).toHaveLength(12);
    expect(Math.max(...sourceNames.map(
      (source) => result.filter((article) => article.sourceName === source).length,
    ))).toBe(2);
    expect(result[0].articleURL).toBe("https://example.com/article-0");

    expect(() => assembleArticles(candidates.slice(0, 9), selections.slice(0, 9))).toThrow(
      "only 9 valid stories remained",
    );
  });

  it("sorts selected stories by relevance before choosing the headline", () => {
    const candidates = Array.from({ length: 10 }, (_, index) =>
      candidate({
        id: `ranked-${index}`,
        sourceName: `Source ${Math.floor(index / 2)}`,
        articleURL: `https://example.com/ranked-${index}`,
      }),
    );
    const selections: EditorialSelection[] = candidates.map((article, index) => ({
      id: article.id,
      localizations: {
        en: {
          title: `Useful ranked AI update number ${index + 1}`,
          summary:
            "A practical AI feature is now available to everyday users. It can reduce repetitive work in a concrete workflow.",
        },
        de: {
          title: `Nützliches bewertetes KI-Update Nummer ${index + 1}`,
          summary:
            "Eine praktische KI-Funktion ist jetzt für alltägliche Nutzer verfügbar. Sie kann wiederkehrende Arbeit in einem konkreten Ablauf reduzieren.",
        },
      },
      category: "product",
      relevanceScore: 80 + index,
    }));

    const result = assembleArticles(candidates, selections);
    expect(result.map((article) => article.relevanceScore)).toEqual([
      89, 88, 87, 86, 85, 84, 83, 82, 81, 80,
    ]);
    expect(result[0].id).toBe("ranked-9");
  });

  it("keeps the app's existing JSON contract", () => {
    const candidates = Array.from({ length: 10 }, (_, index) =>
      candidate({
        id: `contract-${index}`,
        sourceName: `Source ${Math.floor(index / 2)}`,
        articleURL: `https://example.com/contract-${index}`,
      }),
    );
    const articles = assembleArticles(
      candidates,
      candidates.map((article, index) => ({
        id: article.id,
        localizations: {
          en: {
            title: "A useful AI feature is now available",
            summary:
              "A broadly available product gained a concrete new capability. Readers can use it today in a practical workflow.",
          },
          de: {
            title: "Eine nützliche KI-Funktion ist jetzt verfügbar",
            summary:
              "Ein breit verfügbares Produkt hat eine konkrete neue Funktion erhalten. Leser können sie heute in einem praktischen Arbeitsablauf einsetzen.",
          },
        },
        category: "product" as const,
        relevanceScore: 90 - index,
      })),
    );
    const digest = buildDigest(articles, new Date("2026-08-03T18:50:00.000Z"), "pm", {
      feedsAttempted: 10,
      feedsSucceeded: 9,
      articlesProcessed: 42,
    });

    expect(digest.digestDate).toBe("2026-08-03");
    expect(digest.digestSlot).toBe("pm");
    expect(digest.availableLanguages).toEqual(["en", "de"]);
    expect(digest.headline?.id).toBe("contract-0");
    expect(digest.headline?.title).toBe(digest.headline?.localizations.en.title);
    expect(digest.headline?.summary).toBe(digest.headline?.localizations.en.summary);
    expect(digest.headline?.localizations.de.title).toBe(
      "Eine nützliche KI-Funktion ist jetzt verfügbar",
    );
    expect(digest.articles).toHaveLength(9);
    expect(digest.metadata.articlesSelected).toBe(10);
  });
});
