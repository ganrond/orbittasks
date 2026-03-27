// ArcForge — Explore Mode API
// Calls Tavily search + Claude to return a summary + best resource for a topic
module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const tavilyKey    = process.env.TAVILY_API_KEY;

    if (!anthropicKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });
    if (!tavilyKey)    return res.status(500).json({ error: 'TAVILY_API_KEY not set.' });

    const { topic, filter = 'all', masterPrompt = '' } = req.body || {};
    if (!topic || !topic.trim()) return res.status(400).json({ error: 'topic is required.' });

    try {
        // Build Tavily query with filter hint
        let query = topic.trim();
        if (filter === 'podcast') query += ' podcast episode';
        else if (filter === 'video') query += ' youtube video tutorial';
        else if (filter === 'article') query += ' article guide explained';

        // 1. Call Tavily search
        const tavilyRes = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_key: tavilyKey,
                query,
                search_depth: 'basic',
                max_results: 6,
                include_answer: true,
            }),
        });

        if (!tavilyRes.ok) {
            const errText = await tavilyRes.text();
            return res.status(500).json({ error: `Tavily error: ${errText}` });
        }

        const tavilyData = await tavilyRes.json();
        const results = (tavilyData.results || []).map(r => ({
            title: r.title || '',
            url: r.url || '',
            content: (r.content || '').slice(0, 350),
        }));

        if (!results.length) {
            return res.status(200).json({
                summary: 'No results found for this topic. Try rephrasing your search.',
                resource: null,
            });
        }

        // 2. Build prompt for Claude
        const resourcePreference =
            filter === 'podcast' ? 'a podcast episode (look for Spotify, podcast URLs, or episode titles)' :
            filter === 'video'   ? 'a YouTube video or video tutorial' :
            filter === 'article' ? 'a written article, blog post, or guide' :
            'the single best resource regardless of type (podcast, video, or article)';

        const systemPrompt = `You are ArcForge AI, a sharp assistant for a creative entrepreneur.
${masterPrompt ? `\nUser's personal context:\n${masterPrompt}\n` : ''}
The user is a video editor building a creative agency. They have limited time and think practically. Give them direct, useful information — no fluff or jargon.

You will receive a topic and real web search results. Return ONLY a valid JSON object with this exact structure — no markdown fences, no other text:
{
  "summary": "3-4 sentences in plain language, framed around what this means for a video editor / agency builder with limited time",
  "resource": {
    "title": "exact title of the resource",
    "source": "source name, e.g. 'How I Built This · Spotify' or 'YouTube' or 'Harvard Business Review'",
    "relevance": "one sentence explaining why this specific resource is worth their time",
    "url": "the exact URL from the search results"
  }
}

For the resource, prefer ${resourcePreference}. Pick only ONE best resource. The URL must come from the search results provided — do not invent URLs.`;

        const userMessage = `Topic: "${topic}"

Web search results:
${results.map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.content}`).join('\n\n')}

Return only valid JSON as described.`;

        // 3. Call Claude (non-streaming — we want structured JSON)
        const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': anthropicKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 1024,
                system: systemPrompt,
                messages: [{ role: 'user', content: userMessage }],
            }),
        });

        if (!claudeRes.ok) {
            const errText = await claudeRes.text();
            return res.status(500).json({ error: `Claude error: ${errText}` });
        }

        const claudeData = await claudeRes.json();
        const raw = claudeData.content?.[0]?.text || '{}';

        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (e) {
            // Try to extract JSON block from the response
            const match = raw.match(/\{[\s\S]*\}/);
            try {
                parsed = match ? JSON.parse(match[0]) : { summary: raw, resource: null };
            } catch (e2) {
                parsed = { summary: raw, resource: null };
            }
        }

        return res.status(200).json(parsed);
    } catch (err) {
        console.error('[Explore error]', err);
        if (!res.headersSent) {
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }
};
