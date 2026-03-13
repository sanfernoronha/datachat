# DataChat

AI-powered data analysis platform. Upload datasets, ask questions in natural language, and get Python-driven insights — all inside an interactive notebook with a chat panel.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/) (v2+)
- An API key from a supported LLM provider

## Quick Start

```bash
git clone <repo-url>
cd datachat
cp .env.example .env
```

Open `.env` and add your API key. We recommend **Anthropic Claude** (default, best-tested for tool calling):

```env
MODEL_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

Get a key at [console.anthropic.com](https://console.anthropic.com/). The default model is `claude-sonnet-4-6`.

<details>
<summary>Using OpenAI or Google instead</summary>

```env
# OpenAI
MODEL_PROVIDER=openai
OPENAI_API_KEY=sk-your-key-here

# Google
MODEL_PROVIDER=google
GOOGLE_API_KEY=your-key-here
```

Only the key for your active `MODEL_PROVIDER` is required.
</details>

Then start everything:

```bash
docker compose up
```

| Service     | Port | Description                              |
|-------------|------|------------------------------------------|
| **app**     | 3000 | Next.js web application                  |
| **db**      | 5432 | PostgreSQL 15                            |
| **sandbox** | 8888 | Jupyter kernel for code execution        |
| **minio**   | 9000 | S3-compatible file storage               |

Database migrations run automatically on first launch. Once ready, open **http://localhost:3000**.

## Usage

1. **Create a session** from the dashboard
2. **Upload a CSV** (or Excel/TSV) in the left sidebar
3. **Ask a question** in the chat — e.g. _"Describe the dataset"_ or _"Correlation analysis"_
4. Watch the AI write and execute Python in the central notebook
5. **Edit and re-run cells** with the Run button or `Shift+Enter`
6. **Add your own cells** via the `+ Code` dividers between cells

## Local Development

Run the Next.js app outside Docker for faster iteration:

```bash
docker compose up db sandbox minio   # infrastructure only
npm install
npx prisma generate
npx prisma migrate dev
npm run dev
```

Uncomment the `DATABASE_URL` and `SANDBOX_URL` lines in your `.env` to point at localhost.

## Troubleshooting

**Sandbox not ready on first launch** — it can take 10-20s to start. If the first message fails, wait and retry.

**Port conflicts** — edit the `ports` mapping in `docker-compose.yml` if 3000, 5432, 8888, or 9000 are taken.

---

Created by [@sanfernoronha](https://github.com/sanfernoronha)
