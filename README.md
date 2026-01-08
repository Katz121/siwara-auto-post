# siwara-auto-post

Lightweight Node.js app to generate and schedule Facebook posts.

Quick start

1. Copy `.env.example` to `.env` and fill values (do NOT commit `.env`).
2. Install dependencies:

```powershell
npm install
```

3. Start server:

```powershell
npm start
```

4. Health check:

```
GET http://localhost:3000/health
```

Notes

- To test AI generation without a working Gemini API key, set `GEMINI_MOCK=true` in `.env`.
- Keep secrets (`GEMINI_API_KEY`, `FB_PAGE_ACCESS_TOKEN`) out of the repository.
- Use `POST /api/generate/instant` to generate a quick post; use `/api/test-post` to preview or post to Facebook with `confirm: true`.
