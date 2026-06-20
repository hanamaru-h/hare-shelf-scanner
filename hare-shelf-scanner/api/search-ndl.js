export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { title } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });

  try {
    const url = `https://iss.ndl.go.jp/api/opensearch?title=${encodeURIComponent(title)}&mediatype=1&cnt=3`;
    const ndlRes = await fetch(url);
    const text = await ndlRes.text();

    res.setHeader('Content-Type', 'text/xml; charset=utf-8');
    res.status(200).send(text);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
