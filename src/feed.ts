import { XMLParser } from "fast-xml-parser";

import { FEEDS, LOOKBACK_HOURS, MAX_ENRICHED_ARTICLES } from "./config";
import type { CandidateArticle, FeedSource, FetchResult } from "./types";

const FEED_LIMIT_BYTES = 1_200_000;
const ARTICLE_LIMIT_BYTES = 180_000;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_PARALLEL_FETCHES = 5;

const parser = new XMLParser({
  attributeNamePrefix: "@_",
  ignoreAttributes: false,
  parseTagValue: false,
  processEntities: true,
  trimValues: true,
});

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    return value.map(textValue).find(Boolean) ?? "";
  }
  const object = asRecord(value);
  if (!object) return "";
  for (const key of ["#text", "__cdata", "@_href", "href"]) {
    const candidate = textValue(object[key]);
    if (candidate) return candidate;
  }
  return "";
}

function firstText(object: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = textValue(object[key]);
    if (value) return value;
  }
  return "";
}

export function stripMarkup(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeURL(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("utm_") || ["ref", "source", "campaign"].includes(key)) {
        url.searchParams.delete(key);
      }
    }
    url.hostname = url.hostname.replace(/^www\./, "");
    url.pathname = url.pathname.replace(/\/$/, "");
    return url.toString().replace(/\?$/, "");
  } catch {
    return value.trim().replace(/\/$/, "");
  }
}

async function stableID(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function atomLink(value: unknown): string {
  const links = asArray(value);
  for (const link of links) {
    if (typeof link === "string") return link;
    const object = asRecord(link);
    if (!object) continue;
    const relation = textValue(object["@_rel"]);
    const href = textValue(object["@_href"]);
    if (href && (!relation || relation === "alternate")) return href;
  }
  return "";
}

function extractEntries(document: unknown): unknown[] {
  const root = asRecord(document);
  if (!root) return [];

  const rss = asRecord(root.rss);
  const channel = rss ? asRecord(rss.channel) : null;
  if (channel?.item) return asArray(channel.item);

  const rdf = asRecord(root["rdf:RDF"]);
  if (rdf?.item) return asArray(rdf.item);

  const feed = asRecord(root.feed);
  if (feed?.entry) return asArray(feed.entry);

  return [];
}

export async function parseFeed(
  xml: string,
  source: FeedSource,
  now = new Date(),
): Promise<CandidateArticle[]> {
  const document: unknown = parser.parse(xml);
  const cutoff = now.getTime() - LOOKBACK_HOURS * 60 * 60 * 1_000;
  const entries = extractEntries(document);
  const candidates: CandidateArticle[] = [];

  for (const rawEntry of entries) {
    const entry = asRecord(rawEntry);
    if (!entry) continue;

    const title = stripMarkup(firstText(entry, ["title"]));
    const link = atomLink(entry.link) || firstText(entry, ["guid", "id"]);
    const dateText = firstText(entry, [
      "pubDate",
      "published",
      "updated",
      "dc:date",
      "date",
    ]);
    const published = new Date(dateText);

    if (!title || !link || !Number.isFinite(published.getTime())) continue;
    if (published.getTime() < cutoff || published.getTime() > now.getTime() + 3_600_000) continue;

    const normalizedURL = normalizeURL(link);
    const rawSummary = stripMarkup(
      firstText(entry, ["content:encoded", "description", "summary", "content"]),
    ).slice(0, 1_500);

    candidates.push({
      id: await stableID(normalizedURL),
      title,
      rawSummary,
      articleText: "",
      sourceName: source.name,
      sourceIcon: source.icon,
      articleURL: link,
      publishedAt: published.toISOString(),
      sourceWeight: source.weight,
      sourceKind: source.kind,
      heuristicScore: 0,
      coverageCount: 1,
    });
  }

  return candidates;
}

async function readTextWithLimit(response: Response, byteLimit: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (total < byteLimit) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = byteLimit - total;
      const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
      chunks.push(chunk);
      total += chunk.byteLength;
      if (value.byteLength > remaining) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

async function fetchBounded(url: string, byteLimit: number): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8",
        "User-Agent": "UnlockAI-Digest/2.0 (+https://unlockai.courses)",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await readTextWithLimit(response, byteLimit);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSource(source: FeedSource, now: Date): Promise<CandidateArticle[]> {
  const xml = await fetchBounded(source.url, FEED_LIMIT_BYTES);
  return parseFeed(xml, source, now);
}

export async function fetchAllFeeds(now: Date): Promise<FetchResult> {
  const articles: CandidateArticle[] = [];
  let feedsSucceeded = 0;

  for (let index = 0; index < FEEDS.length; index += MAX_PARALLEL_FETCHES) {
    const batch = FEEDS.slice(index, index + MAX_PARALLEL_FETCHES);
    const results = await Promise.allSettled(batch.map((source) => fetchSource(source, now)));
    results.forEach((result, resultIndex) => {
      const source = batch[resultIndex];
      if (result.status === "fulfilled") {
        feedsSucceeded += 1;
        articles.push(...result.value);
        console.log(JSON.stringify({
          event: "feed_fetched",
          source: source.name,
          articles: result.value.length,
        }));
      } else {
        console.error(JSON.stringify({
          event: "feed_failed",
          source: source.name,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        }));
      }
    });
  }

  return { articles, feedsSucceeded };
}

function extractArticleBody(html: string): string {
  const withoutChrome = html
    .replace(/<(nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  const articleMatch = withoutChrome.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  return stripMarkup(articleMatch?.[1] ?? withoutChrome).slice(0, 3_000);
}

export async function enrichArticleText(
  articles: CandidateArticle[],
  limit = MAX_ENRICHED_ARTICLES,
): Promise<CandidateArticle[]> {
  const enriched = [...articles];
  const enrichCount = Math.min(Math.max(0, limit), articles.length);
  for (let index = 0; index < enrichCount; index += MAX_PARALLEL_FETCHES) {
    const batch = articles.slice(index, Math.min(index + MAX_PARALLEL_FETCHES, enrichCount));
    const results = await Promise.allSettled(
      batch.map(async (article) => {
        const page = await fetchBounded(article.articleURL, ARTICLE_LIMIT_BYTES);
        return { ...article, articleText: extractArticleBody(page) };
      }),
    );
    results.forEach((result, resultIndex) => {
      enriched[index + resultIndex] = result.status === "fulfilled"
        ? result.value
        : batch[resultIndex];
    });
  }
  return enriched;
}
