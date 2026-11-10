// Vercel serverless function: turns Nataly's study material into multiple-choice questions.
// Needs the ANTHROPIC_API_KEY environment variable set in the Vercel project.

const MODEL = process.env.QUIZ_MODEL || 'claude-sonnet-5-5';

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
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'The quiz maker isn’t set up yet. Mohamed needs to add the AI key in Vercel.' });
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

  const content = [];
  for (const im of images) {
    const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(String(im || ''));
    if (m) content.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
  }
  content.push({
    type: 'text',
    text:
      (text ? `Study material:\n<material>\n${text}\n</material>\n\n` : '') +
      (images.length ? 'The photos above are also part of the study material.\n\n' : '') +
      `Write ${count} multiple-choice questions from this material, then submit them with the submit_quiz tool.`,
  });

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8000,
        system: SYSTEM,
        tools: [TOOL],
        tool_choice: { type: 'tool', name: 'submit_quiz' },
        messages: [{ role: 'user', content }],
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (data.error && data.error.message) || `status ${r.status}`;
      return res.status(502).json({ error: `The AI service returned an error: ${msg}` });
    }
    const block = (data.content || []).find((b) => b.type === 'tool_use');
    const raw = (block && block.input && block.input.questions) || [];
    const questions = raw
      .filter((q) => q && q.question && q.correct && Array.isArray(q.wrong) && q.wrong.length >= 3 && q.explanation)
      .slice(0, count)
      .map((q) => ({
        topic: String(q.topic || 'Your notes').slice(0, 40),
        question: String(q.question),
        correct: String(q.correct),
        wrong: q.wrong.slice(0, 3).map(String),
        explanation: String(q.explanation),
      }));
    if (!questions.length) {
      return res.status(502).json({ error: 'The AI didn’t return any usable questions. Try again.' });
    }
    return res.status(200).json({ questions });
  } catch (e) {
    return res.status(500).json({ error: `Something went wrong making the quiz: ${e.message}` });
  }
};
