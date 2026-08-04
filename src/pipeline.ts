import { FEEDS } from "./config";
import { assembleArticles, buildDigest, curateWithOpenAI, prepareCandidates } from "./curation";
import { fetchAllFeeds } from "./feed";
import type {
  DigestArticlePayload,
  DigestPayload,
  WorkflowParams,
} from "./types";

interface RecentArticleRow {
  article_id: string;
}

export interface GenerationResult {
  digestDate: string;
  digestSlot: "am" | "pm";
  articlesSelected: number;
}

async function publishDigest(db: D1Database, digest: DigestPayload): Promise<void> {
  const body = JSON.stringify(digest);
  const date = digest.digestDate;
  const slot = digest.digestSlot;
  const paths = ["latest.json", `archive/${date}-${slot}.json`, `archive/${date}.json`];
  const updatedAt = new Date().toISOString();
  const expiresAt = new Date(new Date(digest.generatedAt).getTime() + 8 * 86_400_000).toISOString();
  const selected = [digest.headline, ...digest.articles].filter(
    (article): article is DigestArticlePayload => article !== null,
  );

  const statements = paths.map((path) =>
    db
      .prepare(
        `INSERT INTO digest_documents (path, content, generated_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           content = excluded.content,
           generated_at = excluded.generated_at,
           updated_at = excluded.updated_at`,
      )
      .bind(path, body, digest.generatedAt, updatedAt),
  );

  statements.push(db.prepare("DELETE FROM recent_articles WHERE expires_at < ?").bind(updatedAt));
  for (const article of selected) {
    statements.push(
      db
        .prepare(
          `INSERT INTO recent_articles
             (article_id, article_url, title, digest_date, published_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(article_id) DO UPDATE SET
             article_url = excluded.article_url,
             title = excluded.title,
             digest_date = excluded.digest_date,
             published_at = excluded.published_at,
             expires_at = excluded.expires_at`,
        )
        .bind(
          article.id,
          article.articleURL,
          article.title,
          date,
          article.publishedAt,
          expiresAt,
        ),
    );
  }

  await db.batch(statements);
}

export async function generateDigest(env: Env, params: WorkflowParams): Promise<GenerationResult> {
  const scheduledAt = params.requestedAt ? new Date(params.requestedAt) : new Date();
  if (!Number.isFinite(scheduledAt.getTime())) throw new Error("Invalid generation timestamp");
  const slot = params.slot ?? (scheduledAt.getUTCHours() < 12 ? "am" : "pm");

  const recent = await env.DB.prepare(
    "SELECT article_id FROM recent_articles WHERE expires_at >= ?",
  )
    .bind(scheduledAt.toISOString())
    .all<RecentArticleRow>();
  const recentIDs = new Set(recent.results.map((row) => row.article_id));

  const fetched = await fetchAllFeeds(scheduledAt);
  const candidates = await prepareCandidates(fetched.articles, recentIDs, scheduledAt);

  console.log(JSON.stringify({
    event: "candidates_prepared",
    requestedAt: scheduledAt.toISOString(),
    feedsSucceeded: fetched.feedsSucceeded,
    fetched: fetched.articles.length,
    candidates: candidates.length,
  }));

  const editorial = await curateWithOpenAI(candidates, env.OPENAI_API_KEY);
  const selectedArticles = assembleArticles(candidates, editorial);
  const digest = buildDigest(selectedArticles, scheduledAt, slot, {
    feedsAttempted: FEEDS.length,
    feedsSucceeded: fetched.feedsSucceeded,
    articlesProcessed: fetched.articles.length,
  });

  await publishDigest(env.DB, digest);

  const result: GenerationResult = {
    digestDate: digest.digestDate,
    digestSlot: digest.digestSlot,
    articlesSelected: digest.metadata.articlesSelected,
  };
  console.log(JSON.stringify({ event: "digest_published", ...result }));
  return result;
}
