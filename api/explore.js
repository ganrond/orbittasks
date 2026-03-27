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
        // Build Tavily query with filter-specific quality signals
        let query = topic.trim();
        let includeDomains = [];

        if (filter === 'podcast') {
            // Search podcast directories directly for known quality shows
            query += ' podcast episode';
            includeDomains = ['open.spotify.com', 'podcasts.apple.com'];
        } else if (filter === 'video') {
            // Restrict to YouTube only — vastly improves relevance
            query += ' explained';
            includeDomains = ['youtube.com'];
        } else if (filter === 'article') {
            // Restrict to high-authority publications
            includeDomains = [
                'hbr.org', 'inc.com', 'fastcompany.com', 'entrepreneur.com',
                'firstround.com', 'paulgraham.com', 'a16z.com', 'ryanholiday.net',
                'sethgodin.com', 'medium.com', 'substack.com'
            ];
        }
        // For 'all': no domain restriction — rely on Claude's quality judgment

        // 1. Call Tavily search
        const tavilyBody = {
            api_key: tavilyKey,
            query,
            search_depth: 'basic',
            max_results: 7,
            include_answer: true,
        };
        if (includeDomains.length) tavilyBody.include_domains = includeDomains;

        const tavilyRes = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(tavilyBody),
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
            filter === 'podcast' ? 'a podcast episode from a well-known show' :
            filter === 'video'   ? 'a YouTube video from an established, recognized channel' :
            filter === 'article' ? 'a written article from a high-authority publication or recognized expert' :
            'the single best resource regardless of type — prioritize authority and relevance over recency';

        const sourceQualityGuidance = `
SOURCE QUALITY — this is critical: only recommend resources from established, recognized, high-authority sources.
- Podcasts: prefer top-rated shows like How I Built This, My First Million, The Tim Ferriss Show, Founders (David Senra), The Knowledge Project, Acquired, Invest Like the Best, Masters of Scale, WorkLife with Adam Grant, or other widely respected business/creativity podcasts. Avoid obscure shows with small audiences.
- YouTube: prefer channels with large established audiences and clear domain expertise — Ali Abdaal, Marques Brownlee, Y Combinator, Lex Fridman, Patrick Boyle, Roberto Blake, Peter McKinnon, or other recognized experts in their field. Avoid random uploads from small/unknown creators.
- Articles: prefer Harvard Business Review, Inc., Fast Company, Entrepreneur, First Round Review, Paul Graham (paulgraham.com), Seth Godin, Ryan Holiday, a16z, Andreessen Horowitz blog, or other recognized domain experts and major publications. Avoid SEO content farms, AI-generated articles, and low-authority blogs.
If none of the search results meet this bar, pick the best available but still note this clearly in the relevance field.`;

        const systemPrompt = `You are ArcForge AI, a sharp assistant for a creative entrepreneur.
${masterPrompt ? `\nUser's personal context:\n${masterPrompt}\n` : ''}
The user is building a creative business. They have limited time and think practically. Give them direct, useful information — no fluff or jargon. Frame the summary around what's actionable for them specifically.

You will receive a topic and real web search results. Return ONLY a valid JSON object with this exact structure — no markdown fences, no other text:
{
  "summary": "3-4 sentences in plain language, focused on what's most useful and actionable for this person",
  "resource": {
    "title": "exact title of the resource",
    "source": "source name, e.g. 'How I Built This · Spotify' or 'Ali Abdaal · YouTube' or 'Harvard Business Review'",
    "relevance": "one sentence on why this specific resource from this specific source is worth their time",
    "url": "the exact URL from the search results — never invent a URL"
  }
}
${sourceQualityGuidance}

For the resource, prefer ${resourcePreference}. Pick only ONE best resource.`;

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
