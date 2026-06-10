// ArcForge — AI Chat Proxy (Anthropic, SSE streaming)
// Keeps the API key server-side. Pipes the Anthropic SSE stream directly to the browser.
// POST body: { messages: [{role, content}...], system: string }
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

    const { messages, system } = req.body || {};
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: 'Invalid messages array.' });
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
                stream: true,
                system: system || '',
                messages,
            }),
        });

        if (!upstream.ok) {
            const errText = await upstream.text();
            return res.status(upstream.status).json({ error: errText });
        }

        // Pipe SSE stream directly to the browser
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(decoder.decode(value, { stream: true }));
        }

        res.end();
    } catch (err) {
        console.error('[AI proxy error]', err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Internal server error.' });
        } else {
            res.end();
        }
    }
};
