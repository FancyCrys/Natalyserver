# Natalyserver

A little site for Nataly's final semester of sonography school, from Mohamed.

- **Scan game:** eight simulated ultrasound scans (thyroid, carotid, color Doppler, breast, scrotum, shoulder, Achilles, and a bonus), ending in a card and a "sonography report".
- **Countdown:** counts down to the last day of the semester, with a new note every day. Turns into a graduation celebration when it hits zero (preview with `#celebrate` at the end of the URL).
- **Study mode:** quiz questions on vascular, small parts and MSK.
- **Checklist:** exams and competencies to tick off.

It's a single static `index.html` with no build step. Progress is saved in the browser's local storage.

## Deploy on Vercel

1. Import this repository in Vercel.
2. Framework preset: **Other**. Leave the build command and output directory empty.
3. Deploy.
