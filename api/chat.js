// ArcForge — AI Chat Proxy (Anthropic)
// Keeps the API key server-side (never exposed to the browser).
// POST body: { messages: [{role, content}...], system: string }  OR  { message: string }
// Response:  { reply: string }
module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        return res.status(500).json({
            error: 'ANTHROPIC_API_KEY is not set in Vercel environment variables.'
        });
    }

    const { message, messages, system } = req.body || {};

    let msgArray = [];
    if (Array.isArray(messages) && messages.length > 0) {
        msgArray = messages;
    } else if (message) {
        msgArray = [{ role: 'user', content: message }];
    } else {
        return res.status(400).json({ error: 'No message provided.' });
    }

    try {
        const upstream = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 2048,
                system: system || '',
                messages: msgArray,
            }),
        });

        if (!upstream.ok) {
            const errText = await upstream.text();
            return res.status(upstream.status).json({ error: errText });
        }

        const data = await upstream.json();
        const reply = data.content?.[0]?.text ?? '';
        return res.status(200).json({ reply });
    } catch (err) {
        console.error('[AI proxy error]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
};
