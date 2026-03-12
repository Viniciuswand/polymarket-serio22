const GAMMA_API = 'https://gamma-api.polymarket.com';

function getQueryValue(value, fallback) {
  if (Array.isArray(value)) {
    return value[0] ?? fallback;
  }
  return value ?? fallback;
}

function parseArrayField(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function pickFirstNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function normalizeMarket(market, event = {}) {
  const outcomes = parseArrayField(market.outcomes);
  const outcomePrices = parseArrayField(market.outcomePrices);
  const clobTokenIds = parseArrayField(market.clobTokenIds);

  const yesPrice = pickFirstNumber(outcomePrices[0]);
  const noPrice = pickFirstNumber(outcomePrices[1]);

  return {
    id: market.id,
    question: market.question || market.title || event.title || 'Mercado sem título',
    slug: market.slug,
    category:
      market.category ||
      event.category ||
      event.series?.title ||
      event.title ||
      'Sem categoria',
    outcomes,
    clobTokenIds,
    yesTokenId: clobTokenIds[0] || null,
    noTokenId: clobTokenIds[1] || null,
    yesPrice,
    noPrice,
    volume24hr: pickFirstNumber(
      market.volume24hr,
      market.volume24Hr,
      market.volume24h,
      market.volume24hrClob,
      market.volume24hrAmm
    ),
    volume: pickFirstNumber(
      market.volume,
      market.volumeNum,
      market.volumeClob,
      market.volumeAmm
    ),
    liquidity: pickFirstNumber(
      market.liquidity,
      market.liquidityNum,
      market.liquidityClob,
      market.liquidityAmm
    ),
    endDate:
      market.endDate ||
      market.endDateIso ||
      event.endDate ||
      event.endDateIso ||
      market.closedTime ||
      null,
    active: Boolean(market.active),
    closed: Boolean(market.closed),
    updatedAt: market.updatedAt || event.updatedAt || null,
    url: market.slug
      ? `https://polymarket.com/event/${market.slug}`
      : event.slug
      ? `https://polymarket.com/event/${event.slug}`
      : 'https://polymarket.com',
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'PolyAlpha-Monitor/2.1',
    },
  });

  const text = await response.text();
  let payload = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      payload?.error ||
      payload?.message ||
      `Upstream HTTP ${response.status}`;
    const err = new Error(message);
    err.status = response.status;
    err.payload = payload;
    throw err;
  }

  return payload;
}

function toEventsArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.events)) return payload.events;
  if (Array.isArray(payload?.data)) return payload.data;
  return null;
}

function toMarketsArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.markets)) return payload.markets;
  if (Array.isArray(payload?.data)) return payload.data;
  return null;
}

function normalizeFromEvents(payload) {
  const events = toEventsArray(payload);
  if (!events) return null;

  return events
    .flatMap((event) => {
      const eventMarkets = Array.isArray(event.markets) ? event.markets : [];
      return eventMarkets.map((market) => normalizeMarket(market, event));
    })
    .filter((market) => market.active && !market.closed);
}

function normalizeFromMarkets(payload) {
  const markets = toMarketsArray(payload);
  if (!markets) return null;

  return markets
    .map((market) => normalizeMarket(market))
    .filter((market) => market.active && !market.closed);
}

function sortByVolume24hr(markets) {
  return markets
    .slice()
    .sort((a, b) => pickFirstNumber(b.volume24hr, b.volume) - pickFirstNumber(a.volume24hr, a.volume));
}

async function fetchMarketsWithFallback({ limit, offset }) {
  const attempts = [];

  const marketParams = new URLSearchParams({
    active: 'true',
    closed: 'false',
    limit: String(limit),
    offset: String(offset),
  });

  const marketUrl = `${GAMMA_API}/markets?${marketParams.toString()}`;

  try {
    const payload = await fetchJson(marketUrl);
    const normalized = normalizeFromMarkets(payload);
    if (normalized) {
      return {
        markets: sortByVolume24hr(normalized),
        request: marketUrl,
        source: 'Polymarket Gamma API /markets',
      };
    }
    attempts.push(`Resposta inesperada em /markets`);
  } catch (error) {
    attempts.push(`/markets -> ${error.message}`);
  }

  const eventParams = new URLSearchParams({
    active: 'true',
    closed: 'false',
    limit: String(limit),
    offset: String(offset),
  });

  const eventsUrl = `${GAMMA_API}/events?${eventParams.toString()}`;

  try {
    const payload = await fetchJson(eventsUrl);
    const normalized = normalizeFromEvents(payload);
    if (normalized) {
      return {
        markets: sortByVolume24hr(normalized),
        request: eventsUrl,
        source: 'Polymarket Gamma API /events',
      };
    }
    attempts.push(`Resposta inesperada em /events`);
  } catch (error) {
    attempts.push(`/events -> ${error.message}`);
  }

  throw new Error(`Falha ao consultar a Gamma API. Tentativas: ${attempts.join(' | ')}`);
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=60');

  try {
    const limitRaw = Number(getQueryValue(req.query?.limit, 60));
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(limitRaw, 1), 100)
      : 60;

    const offsetRaw = Number(getQueryValue(req.query?.offset, 0));
    const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;

    const { markets, request, source } = await fetchMarketsWithFallback({
      limit,
      offset,
    });

    res.status(200).end(
      JSON.stringify({
        markets,
        meta: {
          source,
          fetchedAt: new Date().toISOString(),
          count: markets.length,
          request,
        },
      })
    );
  } catch (error) {
    const status = Number(error.status) || 502;
    res.status(status).end(
      JSON.stringify({
        error: error.message || 'Falha ao consultar o Polymarket.',
        source: 'Polymarket Gamma API',
        fetchedAt: new Date().toISOString(),
      })
    );
  }
};
