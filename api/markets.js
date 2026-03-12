const GAMMA_API = 'https://gamma-api.polymarket.com';

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

function normalizeMarket(market) {
  const outcomes = parseArrayField(market.outcomes);
  const outcomePrices = parseArrayField(market.outcomePrices);
  const clobTokenIds = parseArrayField(market.clobTokenIds);

  const yesPrice = pickFirstNumber(outcomePrices[0]);
  const noPrice = pickFirstNumber(outcomePrices[1]);

  return {
    id: market.id,
    question: market.question,
    slug: market.slug,
    category: market.category || market.groupItemTitle || 'Sem categoria',
    outcomes,
    clobTokenIds,
    yesTokenId: clobTokenIds[0] || null,
    noTokenId: clobTokenIds[1] || null,
    yesPrice,
    noPrice,
    volume24hr: pickFirstNumber(market.volume24hr, market.volume24Hr, market.volume24h),
    volume: pickFirstNumber(market.volume),
    liquidity: pickFirstNumber(market.liquidity, market.liquidityClob, market.liquidityAmm),
    endDate: market.endDate || market.closedTime || null,
    active: Boolean(market.active),
    closed: Boolean(market.closed),
    updatedAt: market.updatedAt || null,
    url: market.slug ? `https://polymarket.com/event/${market.slug}` : 'https://polymarket.com',
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'PolyAlpha-Monitor/2.0',
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
    const message = payload?.error || payload?.message || `Upstream HTTP ${response.status}`;
    const err = new Error(message);
    err.status = response.status;
    err.payload = payload;
    throw err;
  }

  return payload;
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=60');

  try {
    const limitRaw = Number(req.query.limit || 60);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 60;
    const offsetRaw = Number(req.query.offset || 0);
    const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;

    const params = new URLSearchParams({
      active: 'true',
      closed: 'false',
      limit: String(limit),
      offset: String(offset),
      order: 'volume_24hr',
      ascending: 'false',
    });

    const url = `${GAMMA_API}/markets?${params.toString()}`;
    const upstream = await fetchJson(url);

    if (!Array.isArray(upstream)) {
      throw new Error('Formato inesperado retornado pela API de mercados.');
    }

    const markets = upstream.map(normalizeMarket);

    res.status(200).end(JSON.stringify({
      markets,
      meta: {
        source: 'Polymarket Gamma API',
        fetchedAt: new Date().toISOString(),
        count: markets.length,
        request: url,
      }
    }));
  } catch (error) {
    const status = Number(error.status) || 502;
    res.status(status).end(JSON.stringify({
      error: error.message || 'Falha ao consultar o Polymarket.',
      source: 'Polymarket Gamma API',
      fetchedAt: new Date().toISOString(),
    }));
  }
};
