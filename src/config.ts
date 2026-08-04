import type { FeedSource } from "./types";

export const FEEDS: readonly FeedSource[] = [
  {
    name: "OpenAI",
    icon: "sparkles",
    url: "https://openai.com/blog/rss.xml",
    weight: 1.5,
    kind: "primary",
  },
  {
    name: "Google AI",
    icon: "magnifyingglass",
    url: "https://blog.google/technology/ai/rss/",
    weight: 1.45,
    kind: "primary",
  },
  {
    name: "Google Workspace",
    icon: "briefcase",
    url: "https://workspaceupdates.googleblog.com/feeds/posts/default?alt=rss",
    weight: 1.5,
    kind: "primary",
  },
  {
    name: "Microsoft AI",
    icon: "square.grid.2x2",
    url: "https://news.microsoft.com/source/topics/ai/feed/",
    weight: 1.35,
    kind: "primary",
  },
  {
    name: "Mistral AI",
    icon: "wind",
    url: "https://mistral.ai/rss.xml",
    weight: 1.25,
    kind: "primary",
  },
  {
    name: "Hugging Face",
    icon: "face.smiling",
    url: "https://huggingface.co/blog/feed.xml",
    weight: 1.05,
    kind: "primary",
  },
  {
    name: "Zapier",
    icon: "arrow.triangle.branch",
    url: "https://zapier.com/blog/feeds/latest/",
    weight: 1.15,
    kind: "primary",
  },
  {
    name: "TechCrunch",
    icon: "bolt",
    url: "https://techcrunch.com/category/artificial-intelligence/feed/",
    weight: 0.8,
    kind: "editorial",
  },
  {
    name: "The Verge",
    icon: "globe",
    url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
    weight: 0.85,
    kind: "editorial",
  },
  {
    name: "MIT Technology Review",
    icon: "newspaper",
    url: "https://www.technologyreview.com/topic/artificial-intelligence/feed",
    weight: 0.9,
    kind: "editorial",
  },
  {
    name: "VentureBeat",
    icon: "chart.line.uptrend.xyaxis",
    url: "https://venturebeat.com/category/ai/feed/",
    weight: 0.75,
    kind: "editorial",
  },
] as const;

export const LOOKBACK_HOURS = 48;
export const MAX_MODEL_CANDIDATES = 28;
export const MAX_DIGEST_ARTICLES = 7;
export const MIN_DIGEST_ARTICLES = 2;
export const MAX_ARTICLES_PER_SOURCE = 2;

export const BLOCKED_PATTERNS: readonly RegExp[] = [
  /\b(trump|biden|congress|senate|parliament|election|campaign|politic(?:s|al)|government)\b/i,
  /\b(china|america(?:n)?|geopolitic|supremacy|trade war|protectionism)\b/i,
  /\b(regulation|regulator|legislation|executive order|eu ai act|policy fight|geopolitic)\b/i,
  /\b(military|weapon|warfare|national security|surveillance)\b/i,
  /\b(funding|fundraise|raised \$|valuation|venture capital|investor|acquisition|ipo)\b/i,
  /\b(influencer|backlash|controversy|culture war|lawsuit|court battle)\b/i,
  /\b(layoff|job cuts|replaces workers|taking jobs)\b/i,
  /\b(humanoid|robotics?|self-driving|autonomous vehicle|data center|power grid|semiconductor)\b/i,
  /\b(alignment|existential risk|agi timeline|sentien(?:t|ce)|consciousness)\b/i,
  /\b(ai agents? (?:lie|cheat)|deceptive behavior|scheming model)\b/i,
  /\b(opinion|editorial|podcast|interview|weekly roundup)\b/i,
];

export const AI_RELEVANCE_PATTERNS: readonly RegExp[] = [
  /\b(ai|artificial intelligence|machine learning|generative ai|large language model|llm)\b/i,
  /\b(chatgpt|gpt(?:-|\b)|openai|claude|anthropic|gemini|copilot|notebooklm)\b/i,
  /\b(mistral|hugging face|perplexity|midjourney|stable diffusion|sora|firefly)\b/i,
  /\b(prompt(?:ing)?|ai agent|agentic|text-to-(?:image|video|speech)|voice ai)\b/i,
];

export const UTILITY_PATTERNS: readonly RegExp[] = [
  /\b(available|availability|launch(?:ed)?|release(?:d)?|rollout|ships?|update(?:d)?)\b/i,
  /\b(feature|tool|app|model|assistant|agent|workflow|integration|plugin|extension)\b/i,
  /\b(how to|guide|tutorial|prompt|template|automation|productivity)\b/i,
  /\b(chatgpt|claude|gemini|copilot|notebooklm|canva|notion|zapier|perplexity)\b/i,
  /\b(free|pricing|subscription|access|mobile|iphone|android|desktop|web)\b/i,
  /\b(image|video|voice|audio|presentation|spreadsheet|email|social media|marketing)\b/i,
];
