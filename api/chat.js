// ArcForge — AI Chat Proxy (Google Gemini)
// Keeps the API key server-side (never exposed to the browser).
// POST body: { messages: [{role, content}...], system: string }  OR  { message: string }
// Response:  { reply: string }
module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({
            error: 'GOOGLE_AI_API_KEY is not set. Add it in Vercel → Settings → Environment Variables.'
        });
    }

    const { message, messages, system } = req.body || {};

    // Build Gemini contents array from chat history or a single message
    let contents = [];
    if (Array.isArray(messages) && messages.length > 0) {
        contents = messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
        }));
    } else if (message) {
        contents = [{ role: 'user', parts: [{ text: message }] }];
    } else {
        return res.status(400).json({ error: 'No message provided.' });
    }

    const body = { contents };
    if (system) {
        body.systemInstruction = { parts: [{ text: system }] };
    }

    try {
        const upstream = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            }
        );

        if (!upstream.ok) {
            const errText = await upstream.text();
            return res.status(upstream.status).json({ error: errText });
        }

        const data = await upstream.json();
        const reply = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        return res.status(200).json({ reply });
    } catch (err) {
        console.error('[AI proxy error]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
};
