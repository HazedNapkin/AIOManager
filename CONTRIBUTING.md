# Contributing to AIOManager

Thank you for even considering this. AIOManager started as something I built strictly for myself and I genuinely didn't expect anyone to find it, let alone want to contribute to it. PRs are welcome and I appreciate anyone willing to put in the time.

Feel free to fork the project and build whatever you want. If I happen to see a PR and want to merge it, cool. If not, no worries! The project is feature-complete as of v2.0. Bug fixes and quality-of-life improvements are welcome, but large architectural changes are unlikely to be merged.

---

## How the project is structured

There are two parts to this:

```
/          The frontend (React + Vite + TypeScript)
/server    The sync and Autopilot backend (Node.js + Fastify + SQLite)
```

The frontend is a fully client-side app. The server is optional and only needed if you're working on cloud sync, Autopilot rules, or webhooks. The app works fine without it using local storage only.

---

## Getting it running locally

### What you need

- Node.js v22.6 or higher (required for --experimental-strip-types + --env-file)
- npm v9 or higher

### Frontend

```bash
npm install
npm run dev
```

That runs on `http://localhost:5173` by default. For a production build it's just `npm run build`.

### Server (only if you need it)

```bash
cd server
npm install
```

Then run it **from the repository root** so it picks up your `.env`:

```bash
npm run server
```

(`npm run dev` at the root runs both the frontend and the server together — that's the easiest path.)

You'll need a `.env` file at the repository root (copy `.env.example`). It documents every variable; the essentials:

```env
# Encryption key for data at rest. If you leave this blank, a random one gets
# generated and saved to DATA_DIR/server_secret.key on the first run. That's fine for local dev.
ENCRYPTION_KEY=

# Port. The server's default is 1610; the sample sets 16100 so a dev instance
# doesn't clash with a Docker install on 1610.
PORT=16100

# Where the database and secrets are stored (default is ./data)
DATA_DIR=./data
```

In dev, the frontend proxies `/api` calls through Vite to your `PORT` (16100 in the sample). Run both and they connect.

---

## The stack

| | |
|---|---|
| Frontend | React 19, TypeScript, Vite |
| Styling | Tailwind CSS + shadcn/ui |
| State | Zustand |
| Local storage | localforage (IndexedDB) |
| Backend | Fastify, SQLite via better-sqlite3 |

---

## Submitting a PR

1. Fork the repo and create a branch off `main`
2. Make your changes, keep them focused on one thing
3. Run `npm run lint` and `npm run typecheck` — both must pass clean
4. Open a PR against `main` and describe what you changed and why

### Good places to start

- Open bug reports on GitHub
- Edge case handling or error messages that could be clearer
- Mobile and responsive layout issues
- Docs

### A few things to keep in mind

- Keep changes small and targeted. One focused PR is a lot easier to review than a large one touching everything.
- If you're fixing a bug, describe how to reproduce it.
- CI enforces `npm run lint` (zero warnings allowed) plus typechecks, and a pre-commit hook lints staged TS/TSX — run `npm run lint` locally before pushing.
- This is maintained on a best-effort basis so reviews may take some time. I appreciate the patience.

---

## Questions

If something seems like a bug or you want to run an idea by me before writing code, just open a GitHub issue. That's the best place for it.
