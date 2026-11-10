// Vercel serverless function: an educational "second look" at an ultrasound image for Nataly.
// Uses OpenAI when OPENAI_API_KEY is set, otherwise Claude when ANTHROPIC_API_KEY is set.

const OPENAI_MODELS = [process.env.OPENAI_VISION_MODEL, process.env.OPENAI_MODEL, 'gpt-5.4-mini', 'gpt-5-mini', 'gpt-4.1-mini'].filter(Boolean);
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';

const SYSTEM = `You are a study helper for Nataly, a sonography student in her final semester. She uploads ultrasound images (often photos of a screen) to practice image interpretation.
Your job is educational, not diagnostic:
- Describe what is visible in proper sonographic language: plane and orientation if you can tell, echogenicity, echotexture, margins, shape, posterior features (shadowing, enhancement), and any Doppler color.
- Name the structures you can identify, and say when you are unsure.
- List possible findings and a short differential the way an instructor would discuss a case. Never state a definitive diagnosis.
- Suggest what a sonographer would do next to characterize it: extra planes, measurements, Doppler, compression, comparison with the other side, and so on.
- Add one short teaching point she can remember.
- Be honest about limits: photos of screens, low resolution, missing labels and a single frame all reduce confidence. If the image is not an ultrasound, or is too unclear to interpret, say so.
- Read any on-screen text (labels, measurements, presets) that helps, but never repeat patient names, IDs or dates of birth.
Keep every field concise and clear.`;

const okPass = (s) =>
  /^t[ie]+[sz]+a*k+b+(5|kh|k|h)a+t+$/.test(String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''));

const str = (d) => ({ type: 'string', description: d });
const list = (d) => ({ type: 'array', items: { type: 'string' }, description: d });
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    is_ultrasound: { type: 'boolean', description: 'False if the image is not an ultrasound image' },
    summary: str('One or two sentences: what this image most likely shows'),
    view: str('Body region, plane and orientation if identifiable, otherwise "Not clear"'),
    structures: list('Structures you can identify'),
    findings: {
      type: 'array',
      description: 'Notable observations, each with its sonographic description',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { finding: str('Short name'), description: str('Sonographic description') },
        required: ['finding', 'description'],
      },
    },
    differentials: list('Possible explanations to consider, most likely first'),
    next_steps: list('What a sonographer would do next to characterize it'),
    teaching_point: str('One short thing to remember'),
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    image_limits: str('What about the image limits the read, or "None"'),
  },
  required: ['is_ultrasound', 'summary', 'view', 'structures', 'findings', 'differentials', 'next_steps', 'teaching_point', 'confidence', 'image_limits'],
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST.' });
  }
  if (!okPass(req.headers['x-nataly-pass'])) return res.status(401).json({ error: 'The scan reader is only for Nataly.' });
  const openaiKey = process.env.OPENAI_API_KEY;
  const claudeKey = process.env.ANTHROPIC_API_KEY;
  if (!openaiKey && !claudeKey) {
    return res.status(500).json({ error: 'The scan reader isn’t set up yet. Mohamed needs to add the AI key in Vercel.' });
  }

  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const imgs = [];
  for (const im of (Array.isArray(body.images) ? body.images : []).slice(0, 2)) {
    const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(String(im || ''));
    if (m) imgs.push({ url: m[0], mediaType: m[1], data: m[2] });
  }
  if (!imgs.length) return res.status(400).json({ error: 'Add a photo or screenshot of the scan first.' });
  const region = String(body.region || '').slice(0, 60);
  const note = String(body.note || '').slice(0, 1500);
  const prompt =
    'Please review this ultrasound image for me.' +
    (region && region !== 'Not sure' ? `\nBody region: ${region}.` : '') +
    (note ? `\nMy notes or question: ${note}` : '');

  try {
    const result = openaiKey ? await askOpenAI(openaiKey, prompt, imgs) : await askClaude(claudeKey, prompt, imgs);
    if (!result || typeof result.summary !== 'string') throw new Error('The AI reply couldn’t be read. Try again.');
    return res.status(200).json({ result });
  } catch (e) {
    return res.status(502).json({ error: e.message || 'Something went wrong reading the scan.' });
  }
};

async function askOpenAI(key, prompt, imgs) {
  const content = [{ type: 'text', text: prompt }, ...imgs.map((i) => ({ type: 'image_url', image_url: { url: i.url, detail: 'high' } }))];
  let lastErr = 'unknown error';
  for (const model of OPENAI_MODELS) {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        max_completion_tokens: 12000,
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content }],
        response_format: { type: 'json_schema', json_schema: { name: 'scan_read', strict: true, schema: SCHEMA } },
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      const txt = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      try { return JSON.parse(txt); } catch { throw new Error('The AI reply couldn’t be read. Try again.'); }
    }
    lastErr = (data.error && data.error.message) || `status ${r.status}`;
    if (!(r.status === 404 || /model/i.test(lastErr))) break;
  }
  throw new Error(`The AI service returned an error: ${lastErr}`);
}

async function askClaude(key, prompt, imgs) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      system: SYSTEM,
      tools: [{ name: 'submit_read', description: 'Submit the scan review.', input_schema: SCHEMA }],
      tool_choice: { type: 'tool', name: 'submit_read' },
      messages: [{ role: 'user', content: [
        ...imgs.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mediaType, data: i.data } })),
        { type: 'text', text: prompt },
      ] }],
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`The AI service returned an error: ${(data.error && data.error.message) || `status ${r.status}`}`);
  const block = (data.content || []).find((b) => b.type === 'tool_use');
  return block && block.input;
}
