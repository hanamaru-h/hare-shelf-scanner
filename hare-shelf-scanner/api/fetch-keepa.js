export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { isbn, apiKey } = req.body;
  if (!isbn || !apiKey) return res.status(400).json({ error: 'isbn and apiKey are required' });

  try {
    const ean = isbn.replace(/-/g, '');
    const url = `https://api.keepa.com/product?key=${apiKey}&domain=5&code=${ean}&stats=90`;
    const keepaRes = await fetch(url);
    const data = await keepaRes.json();
    const product = data.products?.[0];

    if (!product) return res.status(200).json({ result: null });

    const rank = product.stats?.current?.[3] ?? null;
    const newPrice = product.stats?.current?.[0] !== -1 ? product.stats?.current?.[0] : null;
    const usedPrice = product.stats?.current?.[2] !== -1 ? product.stats?.current?.[2] : null;
    const minPrice = newPrice !== null && usedPrice !== null ? Math.min(newPrice, usedPrice) : (newPrice ?? usedPrice ?? null);
    const sellPrice = minPrice !== null ? Math.round(minPrice / 100) : null;
    const profit = sellPrice !== null ? sellPrice - 350 - 220 : null;

    res.status(200).json({
      result: { rank, sellPrice, profit, asin: product.asin ?? null, title: product.title ?? null }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
