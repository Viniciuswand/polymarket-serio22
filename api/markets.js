const GAMMA_API = 'https://gamma-api.polymarket.com';
const REQUEST_TIMEOUT_MS = 12000;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

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

function isRetryableNetworkError(error) {
  const code = error?.cause?.code || error?.code;
  return ['ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EAI_AGAIN'].includes(code);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, { retries = 2 } = {}) {
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'PolyAlpha-Monitor/2.2',
        },
      });

      clearTimeout(timeout);

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

        if (RETRYABLE_STATUS.has(response.status) && attempt < retries) {
          await delay(300 * (attempt + 1));
          continue;
        }

        throw err;
      }

      return payload;
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
      if (error?.name === 'AbortError' || isRetryableNetworkError(error)) {
        await delay(300 * (attempt + 1));
        continue;
      }
      break;
    }
  }

  throw lastError || new Error('Falha de rede ao consultar a API upstream.');
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

  const strategies = [
    {
      source: 'Polymarket Gamma API /markets',
      path: '/markets',
      params: {
        active: 'true',
        closed: 'false',
        limit: String(limit),
        offset: String(offset),
      },
      normalize: normalizeFromMarkets,
    },
    {
      source: 'Polymarket Gamma API /markets (fallback sem filtros)',
      path: '/markets',
      params: {
        limit: String(limit),
        offset: String(offset),
      },
      normalize: normalizeFromMarkets,
    },
    {
      source: 'Polymarket Gamma API /events (includeMarkets)',
      path: '/events',
      params: {
        active: 'true',
        closed: 'false',
        includeMarkets: 'true',
        limit: String(limit),
        offset: String(offset),
      },
      normalize: normalizeFromEvents,
    },
    {
      source: 'Polymarket Gamma API /events',
      path: '/events',
      params: {
        active: 'true',
        closed: 'false',
        limit: String(limit),
        offset: String(offset),
      },
      normalize: normalizeFromEvents,
    },
  ];

  for (const strategy of strategies) {
    const params = new URLSearchParams(strategy.params);
    const requestUrl = `${GAMMA_API}${strategy.path}?${params.toString()}`;

    try {
      const payload = await fetchJson(requestUrl, { retries: 2 });
      const normalized = strategy.normalize(payload);

      if (normalized && normalized.length > 0) {
        return {
          markets: sortByVolume24hr(normalized),
          request: requestUrl,
          source: strategy.source,
        };
      }

      attempts.push(`${strategy.path} -> resposta sem mercados`);
    } catch (error) {
      attempts.push(`${strategy.path} -> ${error.message}`);
    }
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
