export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  
  const { base64, mimeType } = req.body;
  
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.VITE_ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: 'あなたは本棚の写真から本のタイトルを読み取る専門家です。写真に写っている本の背表紙のタイトルを全て読み取り、JSON配列のみで返してください。マークダウンや説明文は不要です。例: ["タイトル1","タイトル2"]',
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
            { type: 'text', text: 'この本棚の写真に写っている本のタイトルを全て読み取ってJSON配列で返してください。' }
          ]
        }]
      })
    });
    
    const data = await response.json();
    const text = data.content?.find(b => b.type === 'text')?.text || '[]';
    let titles;
    try { titles = JSON.parse(text.replace(/```json|```/g, '').trim()); }
    catch { titles = []; }
    
    res.status(200).json({ titles });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
