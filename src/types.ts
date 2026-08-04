export type DigestCategory = "product" | "tutorial" | "industry" | "news";

export interface FeedSource {
  name: string;
  icon: string;
  url: string;
  weight: number;
  kind: "primary" | "editorial";
}

export interface CandidateArticle {
  id: string;
  title: string;
  rawSummary: string;
  articleText: string;
  sourceName: string;
  sourceIcon: string;
  articleURL: string;
  publishedAt: string;
  sourceWeight: number;
  sourceKind: FeedSource["kind"];
  heuristicScore: number;
  coverageCount: number;
}

export interface DigestArticlePayload {
  id: string;
  title: string;
  summary: string;
  sourceName: string;
  sourceIcon: string;
  articleURL: string;
  publishedAt: string;
  category: DigestCategory;
  relevanceScore: number;
}

export interface DigestMetadata {
  feedsAttempted: number;
  feedsSucceeded: number;
  articlesProcessed: number;
  articlesSelected: number;
}

export interface DigestPayload {
  digestDate: string;
  digestSlot: "am" | "pm";
  generatedAt: string;
  headline: DigestArticlePayload | null;
  articles: DigestArticlePayload[];
  metadata: DigestMetadata;
}

export interface FetchResult {
  articles: CandidateArticle[];
  feedsSucceeded: number;
}

export interface EditorialSelection {
  id: string;
  title: string;
  summary: string;
  category: DigestCategory;
  relevanceScore: number;
}

export interface EditorialResponse {
  rankedSelections: EditorialSelection[];
}

export interface WorkflowParams {
  requestedAt?: string;
  slot?: "am" | "pm";
}
