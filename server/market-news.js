const OFFICIAL_FEEDS = [
  { name: "BLS · CPI", url: "https://www.bls.gov/feed/cpi.rss" },
  { name: "BLS · Employment", url: "https://www.bls.gov/feed/empsit.rss" },
  { name: "Federal Reserve", url: "https://www.federalreserve.gov/feeds/press_monetary.xml" },
];
const GDELT_ENDPOINT = "https://api.gdeltproject.org/api/v2/doc/doc";
const GOOGLE_NEWS_RSS_ENDPOINT = "https://news.google.com/rss/search";
const CACHE_TTL_MS = 3 * 60 * 1000;
const RECENT_NEWS_MAX_AGE_MS = 72 * 60 * 60 * 1000;
const CONTEXT_NEWS_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const newsCache = new Map();
const newsLoads = new Map();

function decodeXml(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function cleanText(value, maxLength = 420) {
  return decodeXml(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function readTag(block, tag) {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp("<(?:[\\w.-]+:)??" + escapedTag + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)??" + escapedTag + "\\s*>", "i"));
  return match?.[1] || "";
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  const gdelt = text.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  const parsed = gdelt ? new Date(`${gdelt[1]}-${gdelt[2]}-${gdelt[3]}T${gdelt[4]}:${gdelt[5]}:${gdelt[6]}Z`) : new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function safeHttpUrl(value) {
  try {
    const url = new URL(cleanText(value, 2_000));
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function ageOf(publishedAt) {
  if (!publishedAt) return null;
  const age = Date.now() - new Date(publishedAt).getTime();
  return Number.isFinite(age) ? age : null;
}

function isRecent(publishedAt, maxAgeMs) {
  const age = ageOf(publishedAt);
  return age !== null && age >= -60 * 60 * 1000 && age <= maxAgeMs;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "XAUUSD-Copilot/0.1 (local market news context)", Accept: "application/rss+xml, application/xml, application/json, text/xml" },
    signal: AbortSignal.timeout(7_000),
  });
  if (!response.ok) throw new Error(`News source returned HTTP ${response.status}`);
  return response.text();
}

function parseRss(xml, provider, maxAgeMs = CONTEXT_NEWS_MAX_AGE_MS) {
  return [...String(xml).matchAll(/<(?:[\w.-]+:)?item\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?item\s*>/gi)]
    .map(([, item]) => {
      const title = cleanText(readTag(item, "title"), 240);
      const url = safeHttpUrl(readTag(item, "link"));
      const publishedAt = normalizeDate(cleanText(readTag(item, "pubDate"), 100) || cleanText(readTag(item, "date"), 100));
      let summary = cleanText(readTag(item, "description") || readTag(item, "summary"));
      const publisher = cleanText(readTag(item, "source"), 100);
      const source = provider === "Google News" && publisher ? `Google News · ${publisher}` : provider;
      if (provider === "Google News") {
        summary = cleanText(summary.replace(title, "").replace(publisher, "").replace(/^[\s|·–—-]+|[\s|·–—-]+$/g, "").trim());
      }
      return { title, url, publishedAt, summary, source };
    })
    .filter((item) => item.title && item.url && isRecent(item.publishedAt, maxAgeMs));
}

function isRelevantGoogleHeadline(item, symbol) {
  const ticker = String(symbol || "OANDA:XAUUSD").split(":").at(-1).toUpperCase();
  const title = item.title || "";
  if (/^(XAUUSD|XAU|GOLD)$/i.test(ticker)) {
    const establishedPublisher = /\b(?:reuters|bloomberg|associated press|ap news|cnbc|kitco|financial times|marketwatch|fxstreet|investing\.com|shanghai metals market|vnexpress international|moneyweb|business today|yahoo finance|the economic times|business standard|wall street journal|wsj|thestreet)\b/i;
    if (!establishedPublisher.test(item.source)) return false;
    if (/\b(?:tradingview|olympics|badminton|football|music|single|medal|perishable news|technical analysis)\b/i.test(item.source + " " + title)) return false;
    if (/\b(?:karat|carat|per bhori|bdt|local market|retail gold|price stands at|gold rates? in|gold price in|kuwait|jordan|bangladesh|pakistan|oman|egypt|saudi|uae)\b/i.test(title)) return false;
    if (/\b(?:gold project|preliminary economic assessment|\bnpv\b|\birr\b|gold mine|mining company|ounces? of resources)\b/i.test(title)) return false;
    return /\b(?:xauusd|xau\/usd|bullion|precious metals?|gold price|gold prices|gold market|gold futures|spot gold)\b/i.test(title)
      || /\bgold(?:'s)?\s+(?:edges?|ticks?|moves?|rall(?:y|ies|ied)|slides?|slips?|falls?|drops?|surges?|sells? off|sell-off|comes? lower)\b/i.test(title)
      || /\bgold\s*(?:&|and)\s*silver\b/i.test(title);
  }
  const macroContext = /\b(?:federal reserve|\bfed\b|fomc|inflation|\bcpi\b|\bpce\b|payrolls?|\bnfp\b|treasury yields?|\bdollar\b|interest rates?|central bank|economic data|tariffs?)\b/i;
  return title.toUpperCase().includes(ticker) || macroContext.test(title);
}

async function fetchOfficialFeed(feed) {
  const xml = await fetchText(feed.url);
  return parseRss(xml, feed.name);
}

async function fetchGdelt(symbol) {
  const url = new URL(GDELT_ENDPOINT);
  const ticker = String(symbol || "OANDA:XAUUSD").split(":").at(-1);
  const instrumentTerms = /^(XAUUSD|XAU|GOLD)$/i.test(ticker)
    ? "gold OR XAUUSD OR bullion"
    : '"' + ticker + '"';
  url.searchParams.set("query", '(' + instrumentTerms + ' OR "Federal Reserve" OR inflation OR CPI OR PCE OR payrolls OR Powell OR "Treasury yields" OR dollar) sourcelang:English');
  url.searchParams.set("mode", "artlist");
  url.searchParams.set("format", "json");
  url.searchParams.set("maxrecords", "30");
  url.searchParams.set("timespan", "72h");
  url.searchParams.set("sort", "datedesc");
  const raw = await fetchText(url.href);
  const data = JSON.parse(raw);
  return (Array.isArray(data.articles) ? data.articles : [])
    .map((article) => ({
      title: cleanText(article.title, 240),
      url: safeHttpUrl(article.url),
      publishedAt: normalizeDate(article.seendate),
      summary: "",
      source: cleanText(article.domain || article.sourcecountry || "GDELT news", 100),
    }))
    .filter((item) => item.title && item.url && isRecent(item.publishedAt, RECENT_NEWS_MAX_AGE_MS));
}

async function fetchGoogleNews(symbol) {
  const ticker = String(symbol || "OANDA:XAUUSD").split(":").at(-1);
  const isGold = /^(XAUUSD|XAU|GOLD)$/i.test(ticker);
  const terms = isGold
    ? '("gold price" OR "spot gold" OR XAUUSD OR bullion OR "gold futures" OR "gold market")'
    : `("${ticker}" OR "Federal Reserve" OR inflation OR CPI OR PCE OR payrolls OR Powell OR "Treasury yields" OR dollar)`;
  const queries = isGold ? [`${terms} when:3d`, "gold price Reuters when:3d"] : [`${terms} when:3d`];
  const feeds = await Promise.all(queries.map(async (query) => {
    const url = new URL(GOOGLE_NEWS_RSS_ENDPOINT);
    url.searchParams.set("q", query);
    url.searchParams.set("hl", "en-US");
    url.searchParams.set("gl", "US");
    url.searchParams.set("ceid", "US:en");
    const xml = await fetchText(url.href);
    return parseRss(xml, "Google News", RECENT_NEWS_MAX_AGE_MS);
  }));
  return deduplicate(feeds.flat()).filter((item) => isRelevantGoogleHeadline(item, symbol));
}

function deduplicate(items) {
  const seen = new Set();
  return items.filter((item) => {
    const urlKey = item.url.replace(/[?#].*$/, "").toLowerCase();
    const titleKey = item.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (seen.has(urlKey) || seen.has(titleKey)) return false;
    seen.add(urlKey);
    seen.add(titleKey);
    return true;
  });
}

async function loadMarketNews(symbol) {
  const settled = await Promise.allSettled([
    ...OFFICIAL_FEEDS.map(fetchOfficialFeed),
    fetchGdelt(symbol),
    fetchGoogleNews(symbol),
  ]);
  const officialItems = settled.slice(0, OFFICIAL_FEEDS.length).flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const gdeltResult = settled[OFFICIAL_FEEDS.length];
  const gdeltItems = gdeltResult.status === "fulfilled" ? gdeltResult.value : [];
  const googleNewsResult = settled[OFFICIAL_FEEDS.length + 1];
  const googleNewsItems = googleNewsResult.status === "fulfilled" ? googleNewsResult.value : [];
  settled.forEach((result, index) => {
    if (result.status === "rejected") {
      const sourceName = index < OFFICIAL_FEEDS.length ? OFFICIAL_FEEDS[index].name : index === OFFICIAL_FEEDS.length ? "GDELT" : "Google News RSS";
      console.warn(`[market news] ${sourceName}: ${result.reason?.message || "fetch failed"}`);
    }
  });
  const newestFirst = (items) => [...items].sort((left, right) => (right.publishedAt ? Date.parse(right.publishedAt) : 0) - (left.publishedAt ? Date.parse(left.publishedAt) : 0));
  const official = newestFirst(deduplicate(officialItems));
  const currentOfficial = official.filter((item) => isRecent(item.publishedAt, RECENT_NEWS_MAX_AGE_MS));
  const contextOfficial = official.filter((item) => {
    const age = ageOf(item.publishedAt);
    return age !== null && age > RECENT_NEWS_MAX_AGE_MS && age <= CONTEXT_NEWS_MAX_AGE_MS;
  });
  const recentNews = newestFirst(deduplicate([...gdeltItems, ...googleNewsItems]));
  const items = deduplicate([...currentOfficial, ...recentNews])
    .sort((left, right) => (right.publishedAt ? Date.parse(right.publishedAt) : 0) - (left.publishedAt ? Date.parse(left.publishedAt) : 0))
    .slice(0, 8);
  const contextItems = deduplicate(contextOfficial)
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))
    .slice(0, 3);
  const sources = [...new Set([...items, ...contextItems].map((item) => item.source))];
  const checkedSources = [
    ...OFFICIAL_FEEDS.filter((_, index) => settled[index].status === "fulfilled").map((feed) => feed.name),
    ...(gdeltResult.status === "fulfilled" ? ["GDELT"] : []),
    ...(googleNewsResult.status === "fulfilled" ? ["Google News RSS"] : []),
  ];
  return {
    checkedAt: new Date().toISOString(),
    available: items.length > 0 || contextItems.length > 0,
    items,
    sources,
    checkedSources,
    contextItems,
    recentWindowHours: RECENT_NEWS_MAX_AGE_MS / (60 * 60 * 1000),
  };
}

export async function fetchMarketNews(symbol = "OANDA:XAUUSD") {
  const cacheKey = String(symbol || "OANDA:XAUUSD").toUpperCase();
  const cached = newsCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.news;
  if (newsLoads.has(cacheKey)) return newsLoads.get(cacheKey);
  const loading = loadMarketNews(symbol).then((news) => {
    newsCache.set(cacheKey, { news, expiresAt: Date.now() + (news.available ? CACHE_TTL_MS : 45_000) });
    return news;
  }).catch((error) => {
    console.warn(`[market news] ${error.message || "News fetch failed"}`);
    const fallback = { checkedAt: new Date().toISOString(), available: false, items: [], sources: [] };
    newsCache.set(cacheKey, { news: fallback, expiresAt: Date.now() + 45_000 });
    return fallback;
  }).finally(() => {
    newsLoads.delete(cacheKey);
  });
  newsLoads.set(cacheKey, loading);
  return loading;
}
