import { prepareCandidates } from "../src/curation";
import { fetchAllFeeds } from "../src/feed";

const now = new Date();
const fetched = await fetchAllFeeds(now);
const candidates = await prepareCandidates(fetched.articles, new Set(), now);

console.log(
  JSON.stringify(
    {
      feedsSucceeded: fetched.feedsSucceeded,
      articlesFetched: fetched.articles.length,
      candidates: candidates.map((article) => ({
        score: article.heuristicScore,
        source: article.sourceName,
        title: article.title,
        url: article.articleURL,
      })),
    },
    null,
    2,
  ),
);
