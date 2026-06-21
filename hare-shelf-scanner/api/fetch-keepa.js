const PURCHASE_PRICE = 350;
const FEE = 220;

function productToResult(product) {
  if (!product) return null;
  const rank = product.stats?.current?.[3] ?? null;
  const newPrice = product.stats?.current?.[0] !== -1 ? product.stats?.current?.[0] : null;
  const usedPrice = product.stats?.current?.[2] !== -1 ? product.stats?.current?.[2] : null;
  const minPrice = newPrice !== null && usedPrice !== null ? Math.min(newPrice, usedPrice) : (newPrice ?? usedPrice ?? null);
  const sellPrice = minPrice !== null ? Math.round(minPrice / 100) : null;
  const profit = sellPrice !== null ? sellPrice - PURCHASE_PRICE - FEE : null;
  const offerCount = product.stats?.current?.[11] ?? product.offersCount ?? null;
  return {
    rank,
    sellPrice,
    profit,
    asin: product.asin ?? null,
    title: product.title ?? null,
    offerCount
  };
}

// 複数候補から「一番良さそうな」結果を選ぶ。
// 優先順位: 利益がプラスかつランクが良いものを優先し、なければ利益最大のものを返す。
function pickBest(results) {
  const valid = results.filter(r => r && r.profit !== null);
  if (valid.length === 0) return results.find(r => r) || null;
  valid.sort((a, b) => {
    const aGood = a.rank !== null && a.rank <= 800000 ? 1 : 0;
    const bGood = b.rank !== null && b.rank <= 800000 ? 1 : 0;
    if (aGood !== bGood) return bGood - aGood;
    return (b.profit ?? -Infinity) - (a.profit ?? -Infinity);
  });
  return valid[0];
}

async function fetchByCode(isbn, apiKey) {
  const ean = isbn.replace(/-/g, '');
  const url = `https://api.keepa.com/product?key=${apiKey}&domain=5&code=${ean}&stats=90`;
  const res = await fetch(url);
  const data = await res.json();
  return (data.products || []).map(productToResult).filter(Boolean);
}

async function fetchByTitle(title, apiKey) {
  const url = `https://api.keepa.com/search?key=${apiKey}&domain=5&type=product&term=${encodeURIComponent(title)}&stats=90`;
  const res = await fetch(url);
  const data = await res.json();
  return (data.products || []).map(productToResult).filter(Boolean);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { isbn, title, apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'apiKey is required' });
  if (!isbn && !title) return res.status(400).json({ error: 'isbn or title is required' });

  try {
    let candidates = [];
    let usedMethod = null;

    if (isbn) {
      candidates = await fetchByCode(isbn, apiKey);
      if (candidates.length > 0) usedMethod = 'isbn';
    }

    // ISBNで見つからなかった場合、タイトルでフォールバック検索
    if (candidates.length === 0 && title) {
      candidates = await fetchByTitle(title, apiKey);
      if (candidates.length > 0) usedMethod = 'title';
    }

    if (candidates.length === 0) {
      return res.status(200).json({ result: null, method: null, candidateCount: 0 });
    }

    const best = pickBest(candidates);
    res.status(200).json({ result: best, method: usedMethod, candidateCount: candidates.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
