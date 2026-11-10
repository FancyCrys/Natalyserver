# Natalyserver

A little site for Nataly's final semester of sonography school, from Mohamed.

- **Scan game:** eight simulated ultrasound scans (thyroid, carotid, color Doppler, breast, scrotum, shoulder, Achilles, and a bonus), ending in a card and a "sonography report".
- **Countdown:** counts down to the last day of the semester, with a new note every day. Turns into a graduation celebration when it hits zero (preview with `#celebrate` at the end of the URL).
- **Study mode:** a practice set on vascular, small parts and MSK, plus **From my notes**, where Nataly uploads PowerPoint, Word, PDF, text or photos and the AI writes a quiz from them (`api/quiz.js`).
- **Scan reader:** Nataly uploads a photo or screenshot of an ultrasound and the AI gives an educational second look: structures, findings, differentials and next steps (`api/scan.js`). Study aid only.
- **Checklist:** exams and competencies to tick off.

The site opens with a lock screen (Nataly's inside-joke answer), and it has a link preview image and home-screen icons.

It's a static `index.html` plus one serverless function in `api/`. No build step. Progress is saved in the browser's local storage.

## Deploy on Vercel

1. Import this repository in Vercel.
2. Framework preset: **Other**. Leave the build command and output directory empty.
3. Deploy.

If the Vercel domain isn't `natalyserver.vercel.app`, update the `og:image` and `og:url` tags in `index.html` so link previews show the image.

## Turn on the AI quiz maker

The quiz maker and scan reader work with an OpenAI key (preferred if set) or a Claude key.

1. In Vercel, open the project → **Settings → Environment Variables**.
2. Add `OPENAI_API_KEY` with your OpenAI key (or `ANTHROPIC_API_KEY` for Claude), for all environments.
3. Redeploy (Deployments → ⋯ → Redeploy) so the functions pick it up.

Optional: `OPENAI_MODEL` picks a specific OpenAI model. By default it tries `gpt-5.4-mini`, then `gpt-5-mini`, then `gpt-4.1-mini`, using the first one your account can access. `CLAUDE_MODEL` does the same for Claude (default `claude-sonnet-5-5`).
