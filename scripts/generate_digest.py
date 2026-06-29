#!/usr/bin/env python3
"""
tokn Daily AI Digest Generator

Fetches RSS feeds from 20 diverse AI news sources, deduplicates,
scores, categorizes, summarizes via GPT-4o-mini, and outputs a
curated daily digest as JSON.
"""

import asyncio
import hashlib
import html
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import aiohttp
import feedparser
import yaml
from openai import OpenAI

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).parent
OUTPUT_DIR = SCRIPT_DIR.parent / "output"
ARCHIVE_DIR = OUTPUT_DIR / "archive"
FEEDS_PATH = SCRIPT_DIR / "feeds.yaml"

LOOKBACK_HOURS = 36
MAX_ARTICLES = 12
MIN_ARTICLES = 3
FETCH_TIMEOUT = 10  # seconds per feed

# Languages to translate the digest into, in addition to English.
# Keys must match the app's AppLanguage raw values / .lproj folder names.
LANGUAGES = {
    "de": "German",
    "es": "Spanish",
    "fr": "French",
    "pt": "Portuguese",
    "hi": "Hindi",
    "ar": "Arabic",
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def load_feeds() -> list[dict]:
    with open(FEEDS_PATH) as f:
        data = yaml.safe_load(f)
    return data["sources"]


def strip_html(text: str) -> str:
    """Remove HTML tags and decode entities."""
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def normalize_url(url: str) -> str:
    """Strip tracking params and normalize for dedup."""
    url = re.sub(r"\?utm_[^&]*(&utm_[^&]*)*", "", url)
    url = re.sub(r"[?&]ref=[^&]*", "", url)
    url = url.rstrip("/")
    url = re.sub(r"^https?://(www\.)?", "https://", url)
    return url


def article_id(url: str) -> str:
    return hashlib.sha256(normalize_url(url).encode()).hexdigest()[:16]


def trigrams(text: str) -> set[str]:
    t = text.lower().strip()
    return {t[i : i + 3] for i in range(len(t) - 2)} if len(t) >= 3 else {t}


def jaccard(a: set, b: set) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def parse_date(entry) -> datetime | None:
    """Extract published date from a feedparser entry."""
    for field in ("published_parsed", "updated_parsed"):
        parsed = getattr(entry, field, None)
        if parsed:
            try:
                from time import mktime
                return datetime.fromtimestamp(mktime(parsed), tz=timezone.utc)
            except (ValueError, OverflowError):
                continue
    return None


# ---------------------------------------------------------------------------
# Category keywords
# ---------------------------------------------------------------------------

CATEGORY_KEYWORDS = {
    "research": [
        "paper", "arxiv", "study", "benchmark", "dataset", "model architecture",
        "training", "parameters", "transformer", "diffusion", "fine-tune",
        "preprint", "peer-review", "ablation", "sota",
    ],
    "product": [
        "launch", "release", "available", "update", "announces", "ships",
        "api", "developer", "sdk", "integration", "feature", "rollout",
        "generally available", "beta", "preview",
    ],
    "policy": [
        "regulation", "eu", "congress", "safety", "governance", "executive order",
        "legislation", "compliance", "ban", "oversight", "ethics", "alignment",
        "existential", "risk", "responsible",
    ],
    "opinion": [
        "opinion", "editorial", "think", "should", "why", "perspective",
        "commentary", "argue", "debate", "believe", "essay",
    ],
    "industry": [
        "raises", "funding", "acquisition", "partnership", "enterprise",
        "revenue", "valuation", "ipo", "startup", "series", "investment",
        "hire", "layoff",
    ],
    "tutorial": [
        "how to", "guide", "tutorial", "introduction", "getting started",
        "step by step", "walkthrough", "cookbook", "example",
    ],
}

CLICKBAIT_PATTERNS = [
    r"^[A-Z\s]{10,}$",
    r"[!?]{2,}",
    r"you won't believe",
    r"shocking",
    r"this is (huge|insane|crazy)",
    r"mind.?blow",
]


def categorize(title: str, summary: str, hint: str) -> str:
    text = f"{title} {summary}".lower()
    scores: dict[str, int] = {}
    for cat, keywords in CATEGORY_KEYWORDS.items():
        scores[cat] = sum(1 for kw in keywords if kw in text)
    best = max(scores, key=scores.get)
    if scores[best] >= 2:
        return best
    # Fall back to the source's hint category
    if hint in CATEGORY_KEYWORDS:
        return hint
    return "news"


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------


def score_article(
    article: dict, now: datetime, cross_coverage: dict[str, int]
) -> int:
    """Score 0-100 based on recency, source weight, cross-coverage, title quality."""
    # Recency (0-30)
    age_hours = (now - article["publishedAt"]).total_seconds() / 3600
    recency = max(0, 30 - (age_hours / LOOKBACK_HOURS) * 30)

    # Source weight (0-20)
    source_weight = min(20, article["weight"] * 13)

    # Cross-coverage (0-30)
    norm_url = normalize_url(article["articleURL"])
    coverage_count = cross_coverage.get(norm_url, 1)
    cross = min(30, (coverage_count - 1) * 10)

    # Title quality (0-20)
    title = article["title"]
    quality = 15  # base
    for pattern in CLICKBAIT_PATTERNS:
        if re.search(pattern, title, re.IGNORECASE):
            quality -= 5
    # Reward specificity (numbers, version strings, named entities)
    if re.search(r"\d", title):
        quality += 3
    quality = max(0, min(20, quality))

    return int(recency + source_weight + cross + quality)


# ---------------------------------------------------------------------------
# Fetch
# ---------------------------------------------------------------------------


async def fetch_feed(session: aiohttp.ClientSession, source: dict) -> list[dict]:
    """Fetch and parse a single RSS feed."""
    try:
        async with session.get(
            source["url"], timeout=aiohttp.ClientTimeout(total=FETCH_TIMEOUT)
        ) as resp:
            body = await resp.text()
    except Exception as e:
        print(f"  [FAIL] {source['name']}: {e}", file=sys.stderr)
        return []

    feed = feedparser.parse(body)
    cutoff = datetime.now(timezone.utc) - timedelta(hours=LOOKBACK_HOURS)
    articles = []

    for entry in feed.entries:
        pub_date = parse_date(entry)
        if not pub_date or pub_date < cutoff:
            continue

        link = getattr(entry, "link", "") or ""
        if not link:
            continue

        title = strip_html(getattr(entry, "title", "") or "")
        raw_summary = strip_html(
            getattr(entry, "summary", "") or getattr(entry, "description", "") or ""
        )
        if len(raw_summary) > 500:
            raw_summary = raw_summary[:497] + "..."

        articles.append(
            {
                "id": article_id(link),
                "title": title,
                "rawSummary": raw_summary,
                "sourceName": source["name"],
                "sourceIcon": source["icon"],
                "articleURL": link,
                "publishedAt": pub_date,
                "weight": source.get("weight", 1.0),
                "categoryHint": source.get("category_hint", "news"),
            }
        )

    print(f"  [OK]   {source['name']}: {len(articles)} articles", file=sys.stderr)
    return articles


async def fetch_all_feeds(sources: list[dict]) -> list[dict]:
    """Fetch all feeds concurrently."""
    async with aiohttp.ClientSession() as session:
        tasks = [fetch_feed(session, src) for src in sources]
        results = await asyncio.gather(*tasks)
    return [article for batch in results for article in batch]


# ---------------------------------------------------------------------------
# Dedup
# ---------------------------------------------------------------------------


def deduplicate(articles: list[dict]) -> tuple[list[dict], dict[str, int]]:
    """
    Deduplicate by URL and title similarity.
    Returns (deduped articles, cross_coverage counts by normalized URL).
    """
    # Track cross-coverage: how many sources covered each story
    url_groups: dict[str, list[dict]] = {}
    for a in articles:
        norm = normalize_url(a["articleURL"])
        url_groups.setdefault(norm, []).append(a)

    cross_coverage: dict[str, int] = {}
    deduped_by_url: list[dict] = []
    for norm_url, group in url_groups.items():
        cross_coverage[norm_url] = len(group)
        # Keep the one with highest source weight
        best = max(group, key=lambda x: x["weight"])
        deduped_by_url.append(best)

    # Title similarity dedup
    final: list[dict] = []
    for article in deduped_by_url:
        tri = trigrams(article["title"])
        is_dup = False
        for existing in final:
            if jaccard(tri, trigrams(existing["title"])) > 0.6:
                # Merge cross-coverage
                norm_existing = normalize_url(existing["articleURL"])
                norm_new = normalize_url(article["articleURL"])
                cross_coverage[norm_existing] = (
                    cross_coverage.get(norm_existing, 1)
                    + cross_coverage.get(norm_new, 1)
                )
                is_dup = True
                break
        if not is_dup:
            final.append(article)

    return final, cross_coverage


# ---------------------------------------------------------------------------
# Summarize with GPT
# ---------------------------------------------------------------------------


def summarize_articles(articles: list[dict]) -> list[dict]:
    """Add LLM-generated summaries using GPT-4o-mini."""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("  [WARN] No OPENAI_API_KEY set, using raw summaries", file=sys.stderr)
        for a in articles:
            a["summary"] = a["rawSummary"]
        return articles

    client = OpenAI(api_key=api_key)

    for a in articles:
        try:
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "Write a 2-sentence summary of this article for a daily "
                            "AI news digest. Be factual, concise, and informative. "
                            "No hype or editorializing."
                        ),
                    },
                    {
                        "role": "user",
                        "content": f"Title: {a['title']}\n\nDescription: {a['rawSummary']}",
                    },
                ],
                max_tokens=100,
                temperature=0.3,
            )
            a["summary"] = response.choices[0].message.content.strip()
        except Exception as e:
            print(f"  [WARN] GPT failed for '{a['title'][:40]}': {e}", file=sys.stderr)
            a["summary"] = a["rawSummary"]

    return articles


def translate_digest(
    digest: dict, lang_name: str, client: OpenAI
) -> dict | None:
    """Return a copy of the digest with `title` and `summary` translated into
    `lang_name`. All other fields (id, category, sourceName, URLs, dates,
    metadata) are left unchanged. Returns None if translation fails so the
    caller can simply skip writing that language (the app falls back to English).
    """
    items = []
    if digest.get("headline"):
        items.append(digest["headline"])
    items.extend(digest["articles"])

    if not items:
        return digest  # nothing to translate

    payload = [
        {"id": a["id"], "title": a["title"], "summary": a["summary"]} for a in items
    ]

    system = (
        f"You are a professional translator for a daily AI news digest. "
        f"Translate the 'title' and 'summary' fields of each item into {lang_name}. "
        f"Keep translations natural, concise, and faithful to the meaning. "
        f"Do NOT translate product, company, or model names that are normally kept "
        f"in English (e.g. OpenAI, ChatGPT, Anthropic, Claude, Gemini, GPT-4). "
        f"Return ONLY a JSON object of the form "
        f'{{"items": [{{"id": "...", "title": "...", "summary": "..."}}]}} '
        f"with the same 'id' values, unchanged."
    )

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": json.dumps({"items": payload}, ensure_ascii=False)},
            ],
            max_tokens=4000,
            temperature=0.2,
            response_format={"type": "json_object"},
        )
        data = json.loads(response.choices[0].message.content)
        translations = {item["id"]: item for item in data.get("items", [])}
    except Exception as e:
        print(f"  [WARN] Translation to {lang_name} failed: {e}", file=sys.stderr)
        return None

    def localize(a: dict) -> dict:
        t = translations.get(a["id"])
        if not t:
            return a
        b = dict(a)
        b["title"] = t.get("title") or a["title"]
        b["summary"] = t.get("summary") or a["summary"]
        return b

    out = dict(digest)
    out["headline"] = localize(digest["headline"]) if digest.get("headline") else None
    out["articles"] = [localize(a) for a in digest["articles"]]
    return out


def write_digest(digest: dict, today: str, slot: str, suffix: str = "") -> Path:
    """Write a digest to latest{suffix}.json plus the dated/slot archives.
    `suffix` is "" for English or ".<lang>" for a translation."""
    latest_path = OUTPUT_DIR / f"latest{suffix}.json"
    slot_archive_path = ARCHIVE_DIR / f"{today}-{slot}{suffix}.json"
    date_archive_path = ARCHIVE_DIR / f"{today}{suffix}.json"
    for path in (latest_path, slot_archive_path, date_archive_path):
        with open(path, "w") as f:
            json.dump(digest, f, indent=2, ensure_ascii=False)
    return latest_path


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------


def run_pipeline():
    print("=== tokn Daily Digest Generator ===", file=sys.stderr)
    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")
    slot = "am" if now.hour < 12 else "pm"

    # Load feed sources
    sources = load_feeds()
    print(f"\nFetching {len(sources)} feeds...", file=sys.stderr)

    # Step 1: Fetch
    articles = asyncio.run(fetch_all_feeds(sources))
    print(f"\nFetched {len(articles)} articles total", file=sys.stderr)

    if len(articles) < MIN_ARTICLES:
        print(f"Only {len(articles)} articles found, generating minimal digest", file=sys.stderr)

    # Step 2: Deduplicate
    articles, cross_coverage = deduplicate(articles)
    print(f"After dedup: {len(articles)} unique articles", file=sys.stderr)

    # Step 3: Score
    for a in articles:
        a["relevanceScore"] = score_article(a, now, cross_coverage)

    # Step 4: Categorize
    for a in articles:
        a["category"] = categorize(a["title"], a["rawSummary"], a["categoryHint"])

    # Step 5: Sort by score and select top articles
    articles.sort(key=lambda x: x["relevanceScore"], reverse=True)
    selected = articles[:MAX_ARTICLES]
    print(f"Selected top {len(selected)} articles", file=sys.stderr)

    # Step 6: Summarize with GPT
    print("\nGenerating summaries...", file=sys.stderr)
    selected = summarize_articles(selected)

    # Step 7: Build output
    headline = selected[0] if selected else None
    rest = selected[1:] if len(selected) > 1 else []

    def serialize_article(a: dict) -> dict:
        return {
            "id": a["id"],
            "title": a["title"],
            "summary": a["summary"],
            "sourceName": a["sourceName"],
            "sourceIcon": a["sourceIcon"],
            "articleURL": a["articleURL"],
            "publishedAt": a["publishedAt"].isoformat(),
            "category": a["category"],
            "relevanceScore": a["relevanceScore"],
        }

    digest = {
        "digestDate": today,
        "digestSlot": slot,
        "generatedAt": now.isoformat(),
        "headline": serialize_article(headline) if headline else None,
        "articles": [serialize_article(a) for a in rest],
        "metadata": {
            "feedsAttempted": len(sources),
            "feedsSucceeded": sum(
                1 for _ in sources
            ),  # updated below from actual results
            "articlesProcessed": len(articles),
            "articlesSelected": len(selected),
        },
    }

    # Write output (English / default)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)

    latest_path = write_digest(digest, today, slot)
    print(f"\nDigest written to {latest_path} (+ archives)", file=sys.stderr)
    print(f"Headline: {headline['title'][:80] if headline else 'None'}", file=sys.stderr)
    print(f"Total articles in digest: {len(selected)}", file=sys.stderr)

    # Step 8: Translations — one digest file per language, English stays the
    # fallback. If the API key is missing or a translation fails, that language
    # is skipped and the app falls back to the English `latest.json`.
    api_key = os.environ.get("OPENAI_API_KEY")
    if api_key:
        print("\nGenerating translations...", file=sys.stderr)
        client = OpenAI(api_key=api_key)
        for lang_code, lang_name in LANGUAGES.items():
            translated = translate_digest(digest, lang_name, client)
            if translated:
                write_digest(translated, today, slot, suffix=f".{lang_code}")
                print(f"  Wrote {lang_code} digest", file=sys.stderr)
    else:
        print("  [WARN] No OPENAI_API_KEY, skipping translations", file=sys.stderr)


if __name__ == "__main__":
    run_pipeline()
