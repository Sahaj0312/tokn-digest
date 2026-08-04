import { generateDigest } from "./pipeline";
import type { WorkflowParams } from "./types";

interface DigestDocumentRow {
  content: string;
  generated_at: string;
  updated_at: string;
}

const JSON_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
} as const;

function json(value: unknown, status = 200, cacheControl = "no-store"): Response {
  return Response.json(value, {
    status,
    headers: { ...JSON_HEADERS, "Cache-Control": cacheControl },
  });
}

function documentPath(pathname: string): string | null {
  const path = pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  if (path === "latest.json") return path;
  if (/^archive\/\d{4}-\d{2}-\d{2}(?:-(?:am|pm))?\.json$/.test(path)) return path;
  return null;
}

async function serveDocument(path: string, env: Env): Promise<Response> {
  const row = await env.DB.prepare(
    "SELECT content, generated_at, updated_at FROM digest_documents WHERE path = ?",
  )
    .bind(path)
    .first<DigestDocumentRow>();
  if (!row) return json({ error: "Digest not found" }, 404, "public, max-age=30");

  const immutable = path.startsWith("archive/") && /-(?:am|pm)\.json$/.test(path);
  const cacheControl = immutable
    ? "public, max-age=31536000, immutable"
    : "public, max-age=60, stale-while-revalidate=300";
  return new Response(row.content, {
    headers: {
      ...JSON_HEADERS,
      "Cache-Control": cacheControl,
      "Last-Modified": new Date(row.updated_at).toUTCString(),
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return json({ error: "Method not allowed" }, 405);
      }

      const url = new URL(request.url);
      if (url.pathname === "/" || url.pathname === "") {
        return json({
          service: "UnlockAI Digest",
          language: "en",
          latest: "/latest.json",
          health: "/health",
        });
      }

      if (url.pathname === "/health") {
        const latest = await env.DB.prepare(
          "SELECT generated_at, updated_at FROM digest_documents WHERE path = 'latest.json'",
        ).first<Pick<DigestDocumentRow, "generated_at" | "updated_at">>();
        return json({
          ok: latest !== null,
          generatedAt: latest?.generated_at ?? null,
          publishedAt: latest?.updated_at ?? null,
        });
      }

      const path = documentPath(url.pathname);
      if (!path) return json({ error: "Not found" }, 404, "public, max-age=30");
      const response = await serveDocument(path, env);
      return request.method === "HEAD" ? new Response(null, response) : response;
    } catch (error) {
      console.error(JSON.stringify({
        event: "request_failed",
        path: new URL(request.url).pathname,
        error: error instanceof Error ? error.message : String(error),
      }));
      return json({ error: "Internal server error" }, 500);
    }
  },
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const scheduledAt = new Date(controller.scheduledTime);
    const slot = scheduledAt.getUTCHours() < 12 ? "am" : "pm";
    const message: WorkflowParams = {
      requestedAt: scheduledAt.toISOString(),
      slot,
    };

    await env.GENERATION_QUEUE.send(message);
    console.log(JSON.stringify({ event: "generation_enqueued", ...message }));
  },
  async queue(batch: MessageBatch<WorkflowParams>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        await generateDigest(env, message.body);
      } catch (error) {
        console.error(JSON.stringify({
          event: "generation_failed",
          messageId: message.id,
          attempts: message.attempts,
          error: error instanceof Error ? error.message : String(error),
        }));
        throw error;
      }
    }
  },
} satisfies ExportedHandler<Env, WorkflowParams>;
