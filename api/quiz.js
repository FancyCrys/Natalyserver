// Vercel serverless function: turns Nataly's study material into multiple-choice questions.
// Uses OpenAI when OPENAI_API_KEY is set, otherwise Claude when ANTHROPIC_API_KEY is set.
// Optional: OPENAI_MODEL / CLAUDE_MODEL to pick a specific model.

const OPENAI_MODELS = [process.env.OPENAI_MODEL, 'gpt-5.4-mini', 'gpt-5-mini', 'gpt-4.1-mini'].filter(Boolean);
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';

const SYSTEM = `You write multiple-choice practice questions for Nataly, a sonography student in her final semester (MSK, vascular, small parts: breast, thyroid, scrotum, and general sonography).
Rules:
- Base every question only on the study material provided. Do not invent facts that are not in it.
- Focus on what she needs for exams and clinic: sonographic appearances, normal values and measurements, criteria, protocols, anatomy, artifacts, pathology, and technique.
- Never ask about the document itself (slide numbers, authors, titles, course codes).
- Each question has exactly one correct answer and three wrong answers that are plausible and similar in length and style to the correct one.
- Explanations are one or two sentences that teach why the answer is right.
- Keep wording clear and exam-like. Vary difficulty and cover different parts of the material.`;

const okPass = (s) =>
  /^t[ie]+[sz]+a*k+b+(5|kh|k|h)a+t+$/.test(String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''));

const TOOL = {
  name: 'submit_quiz',
  description: 'Submit the finished quiz.',
  input_schema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            topic: { type: 'string', description: 'Short topic label, 1 to 3 words' },
            question: { type: 'string' },
            correct: { type: 'string' },
            wrong: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 },
            explanation: { type: 'string' },
          },
          required: ['topic', 'question', 'correct', 'wrong', 'explanation'],
        },
      },
    },
    required: ['questions'],
  },
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST.' });
  }
  if (!okPass(req.headers['x-nataly-pass'])) {
    return res.status(401).json({ error: 'This quiz maker is only for Nataly.' });
  }
  const openaiKey = process.env.OPENAI_API_KEY;
  const claudeKey = process.env.ANTHROPIC_API_KEY;
  if (!openaiKey && !claudeKey) {
    return res.status(500).json({ error: 'The quiz maker isn\u2019t set up yet. Mohamed needs to add the AI key in Vercel.' });
  }

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const text = String(body.text || '').slice(0, 60000).trim();
  const images = Array.isArray(body.images) ? body.images.slice(0, 4) : [];
  const count = Math.min(15, Math.max(3, parseInt(body.count, 10) || 10));
  if (text.length < 200 && !images.length) {
    return res.status(400).json({ error: 'There isn’t enough in that file to make questions from.' });
  }

  const imgs = [];
  for (const im of images) {
    const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(String(im || ''));
    if (m) imgs.push({ url: m[0], mediaType: m[1], data: m[2] });
  }
  const prompt =
    (text ? `Study material:\n<material>\n${text}\n</material>\n\n` : '') +
    (imgs.length ? 'The attached photos are also part of the study material.\n\n' : '') +
    `Write ${count} multiple-choice questions from this material.`;

  try {
    const raw = openaiKey
      ? await askOpenAI(openaiKey, prompt, imgs, count)
      : await askClaude(claudeKey, prompt, imgs);
    const questions = clean(raw, count);
    if (!questions.length) {
      return res.status(502).json({ error: 'The AI didn\u2019t return any usable questions. Try again.' });
    }
    return res.status(200).json({ questions });
  } catch (e) {
    return res.status(502).json({ error: e.message || 'Something went wrong making the quiz.' });
  }
};

function clean(raw, count) {
  return (Array.isArray(raw) ? raw : [])
    .filter((q) => q && q.question && q.correct && Array.isArray(q.wrong) && q.wrong.length >= 3 && q.explanation)
    .slice(0, count)
    .map((q) => ({
      topic: String(q.topic || 'Your notes').slice(0, 40),
      question: String(q.question),
      correct: String(q.correct),
      wrong: q.wrong.slice(0, 3).map(String),
      explanation: String(q.explanation),
    }));
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          topic: { type: 'string', description: 'Short topic label, 1 to 3 words' },
          question: { type: 'string' },
          correct: { type: 'string' },
          wrong: { type: 'array', items: { type: 'string' }, description: 'Exactly three wrong answers' },
          explanation: { type: 'string' },
        },
        required: ['topic', 'question', 'correct', 'wrong', 'explanation'],
      },
    },
  },
  required: ['questions'],
};

async function askOpenAI(key, prompt, imgs, count) {
  const userContent = [{ type: 'text', text: prompt }, ...imgs.map((i) => ({ type: 'image_url', image_url: { url: i.url } }))];
  let lastErr = 'unknown error';
  for (const model of OPENAI_MODELS) {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        max_completion_tokens: 16000,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: userContent },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'quiz', strict: true, schema: SCHEMA } },
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      const txt = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      try { return JSON.parse(txt).questions; } catch { throw new Error('The AI reply couldn\u2019t be read. Try again.'); }
    }
    lastErr = (data.error && data.error.message) || `status ${r.status}`;
    const modelProblem = r.status === 404 || /model/i.test(lastErr);
    if (!modelProblem) break; // key, billing or rate-limit problems won't be fixed by another model
  }
  throw new Error(`The AI service returned an error: ${lastErr}`);
}

async function askClaude(key, prompt, imgs) {
  const content = [
    ...imgs.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mediaType, data: i.data } })),
    { type: 'text', text: prompt + ' Submit them with the submit_quiz tool.' },
  ];
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'submit_quiz' },
      messages: [{ role: 'user', content }],
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`The AI service returned an error: ${(data.error && data.error.message) || `status ${r.status}`}`);
  const block = (data.content || []).find((b) => b.type === 'tool_use');
  return (block && block.input && block.input.questions) || [];
}
