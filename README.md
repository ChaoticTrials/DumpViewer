# Dump Viewer

Web-based viewer for [Skyblock Builder](https://github.com/ChaoticTrials/SkyblockBuilder) dump files. Supports browsing configs, islands, world files, and logs directly in the browser.

_This project contains AI-generated content._

## Project structure

```
dump-viewer/
├── frontend/          React + Vite SPA
├── backend/           Express API server
├── Dockerfile
├── docker-compose.example.yml
└── .github/workflows/
    ├── test.yml       Runs tests on PRs and pushes to main
    └── build-push.yml Runs tests, then builds and publishes the Docker image
```

## How it works

The frontend is a single-page app that parses dump `.zip` files entirely in the browser. No file ever has to leave your machine if you open it locally.

The backend is optional for local file loading but required for:

- **URL loading** — the backend fetches the URL server-side, bypassing CORS restrictions
- **Manifest ID routing** — dumps are stored as `<manifest-id>.zip` and accessible at `/<manifest-id>`

In production (Docker), the backend also serves the frontend static files, so only one port is needed.

---

## Using the frontend

### As a regular user (no token required)

Drop a `.zip` onto the drop zone, or click it to open a file picker. Everything happens locally in the browser — no data is sent anywhere, no account is needed.

You can also navigate directly to `/<id>` to view a dump that was previously uploaded to the server.

### As an admin (with auth token)

When the server has `AUTH_TOKEN` set, an **Auth token** field appears in the URL input section. Enter the token before clicking **Open** to store the dump on the server.

Once a dump is loaded locally (drag-and-drop or file picker), an **Upload** button also appears in the header. Click it, enter the auth token, and the dump is saved to the server — this uses the same `POST /api/dump/upload` endpoint as the CLI.

The token is only required for write operations (upload, import, delete, list). Drag-and-drop and viewing already-stored dumps at `/<id>` are always public.

Uploading or importing also returns a `deleteKey` — anyone with that key can delete just that dump without the auth token: opening `/api/delete/<deleteKey>` in a browser shows a confirmation page, and the actual deletion happens via `POST` to the same URL (see [API.md](API.md)). The **Upload** button shows this as a ready-to-share delete link once the upload succeeds; it is shown only once, so copy it if you'll need it later.

To push a dump to the server from the command line, use the API directly (see [API.md](API.md)).

### Viewing files

Pick a file in the sidebar to open it. Configs, NBT and binary files each get their own viewer; `.log` files and `crash-report.txt` additionally get a filter toolbar.

For logs, the **INFO / WARN / ERROR / FATAL / DEBUG** pills toggle which severities are shown; the count next to each pill is how many entries that level has. Deselecting any pill adds a **Reset** button that re-enables all of them.

Both logs and crash reports have a **search box** that filters lines down to those containing what you typed. The search is a plain, case-insensitive substring match — not a regular expression — so pasting a fragment like `[main/ERROR]` or `net.minecraft.world` works verbatim. Matching lines keep their original line numbers, and for logs a matching stack-trace line keeps the whole log entry it belongs to. The chip next to the box shows how many of the file's lines survived the filter, `×` (or <kbd>Escape</kbd>) clears the query, and the search combines with the level pills. Selecting a different file clears the search.

**Copy** and **Download** always export the full file, never the filtered view.

### Admin panel

Navigate to `/admin` to manage all dumps stored on the server. The panel asks for the auth token and keeps it in `sessionStorage` — it survives reloads in the same tab, but a new tab or a closed-and-reopened browser asks again.

The panel lists every stored dump — manifest format, name, link, manifest ID, Minecraft version, Skyblock Builder version, creation date, and expiry — sorted so the dumps expiring soonest come first. Each row has a **View** button (opens the dump at `/<id>` in a new tab) and a **Delete** button (asks for a confirming second click before deleting).

**Name and link** are optional labels for a stored dump — for example "Issue #412" pointing at the GitHub issue the dump came from. They are display metadata only: dumps stay reachable at `/<manifest-id>` and nowhere else, and neither is shown on the dump viewing page.

Click a **Name** or **Link** cell in the admin panel to edit it inline: <kbd>Enter</kbd> saves, <kbd>Escape</kbd> cancels, and emptying the field clears it. A row with no name shows its manifest ID greyed out as a placeholder; a row with no link shows a muted dash. Both can also be supplied when the dump is stored, via the `name`/`link` fields of `POST /api/dump/upload` and `POST /api/dump/import`, or changed later with `PATCH /api/dump/:id` (see [API.md](API.md)). Note that re-uploading a dump with the same manifest ID clears any metadata not sent with that upload.

---

## Docker

A pre-built image is published to `ghcr.io/chaotictrials/dump-viewer` on every tagged release.

### Quick start

```bash
cp docker-compose.example.yml docker-compose.yml
# Edit docker-compose.yml (see below), then:
docker compose up -d
```

The viewer will be available at `http://localhost:3001`.

### docker-compose.yml

```yaml
services:
  dump-viewer:
    image: ghcr.io/chaotictrials/dump-viewer:latest
    ports:
      - '3001:3001'
    environment:
      # Protect write endpoints. Generate with: openssl rand -hex 32
      AUTH_TOKEN: ''
      # Restrict CORS to your frontend origin. Leave empty to allow all origins.
      ALLOWED_ORIGIN: ''
    volumes:
      - dumps:/dumps
    restart: unless-stopped

volumes:
  dumps:
```

Change the host port (`3001:3001` → `8080:3001`) if needed.

### Environment variables

| Variable             | Default                         | Description                                                                                                                                                      |
| -------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_TOKEN`         | _(empty)_                       | Secret token required for upload, import, delete, and list. Leave empty for open access. Generate with `openssl rand -hex 32`.                                   |
| `AUTH_TOKEN_FILE`    | `/run/secrets/dumpviewer_token` | File to read the auth token from when `AUTH_TOKEN` is not set (e.g. a Docker secret).                                                                            |
| `ALLOWED_ORIGIN`     | `*`                             | Value for the `Access-Control-Allow-Origin` response header. Set to your frontend's exact origin (e.g. `https://dumps.example.com`) for a production deployment. |
| `DUMPS_DIR`          | `./dumps`                       | Directory where uploaded zip files are stored. Pre-set to `/dumps` in the Docker image.                                                                          |
| `PORT`               | `3001`                          | Port the server listens on inside the container.                                                                                                                 |
| `FRONTEND_DIR`       | `../frontend/dist`              | Directory of the built frontend served in production (resolved relative to the compiled backend).                                                                |
| `AUTH_FAIL_LIMIT`    | `10`                            | Failed auth attempts (401s) allowed per IP per 15 minutes before all token-gated endpoints answer `429` for that IP.                                             |
| `AUTH_FAIL_DELAY_MS` | `500`                           | Delay in milliseconds before a failed auth attempt is answered — slows down token guessing.                                                                      |
| `GENERAL_RATE_LIMIT` | `100`                           | Requests per IP per 10s on dump read/list/delete endpoints.                                                                                                      |
| `MODPACK_RATE_LIMIT` | `10`                            | Modpack exports per IP per 60s (each export calls external platform APIs).                                                                                       |

### Persisting dumps

Dump files are stored as `<id>.zip` inside `DUMPS_DIR`. The Docker image declares `/dumps` as a volume. Mount a named volume (as above) or a host path to keep uploads across container restarts:

```yaml
volumes:
  - /data/dumps:/dumps
```

### Auto-cleanup

Each dump has a TTL set at upload time (see `ttl` in [API.md](API.md)). The server runs cleanup on startup and once per day, deleting any dump whose TTL has elapsed. Dumps with no TTL set default to 1 year. There is no cap on total dump count.

### Reverse proxy (HTTPS)

The server speaks plain HTTP. For production, put it behind a reverse proxy:

**nginx:**

```nginx
server {
    listen 443 ssl;
    server_name dumps.example.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        client_max_body_size 256m;
    }
}
```

**Caddy:**

```
dumps.example.com {
    reverse_proxy localhost:3001
}
```

Set `ALLOWED_ORIGIN: 'https://dumps.example.com'` in your compose file when restricting CORS.

---

## URL routing

| URL              | Behaviour                                      |
| ---------------- | ---------------------------------------------- |
| `/`              | Drop zone — open a local file or load from URL |
| `/<manifest-id>` | Load a specific dump from the backend          |

If a manifest ID is in the URL but no matching dump exists on the backend, a "No dump available" page is shown with a link back to the home page.

---

## Validation

Every uploaded zip is validated before being stored:

- Must be a valid zip archive
- Must contain `manifest.json`
- `manifest.json` must include `manifest_version` (number), `manifest_id` (UUID v4), `versions.skyblockbuilder` (string), `versions.minecraft` (string), and `files` (array)

This ensures only genuine Skyblock Builder dumps can be stored.

### Supported manifest versions

| Version | Changed-values format                              | Notes                                                               |
| :-----: | -------------------------------------------------- | ------------------------------------------------------------------- |
|   v1    | JSON5 subset (`config/changed_values/<name>`)      | Line-level diff highlighting                                        |
|   v2    | Unified diff (`config/changed_values/<base>.diff`) | Diff tab with syntax highlighting; adds `hashes` field for mod JARs |

The frontend auto-detects the manifest version and renders the appropriate UI. Adding v3 in the future only requires a new `manifest/v3/` module.

---

## Development

### Prerequisites

- Node.js 24+

### Install

```bash
npm run install:all
```

### Run

```bash
npm run dev
```

Starts the frontend on `http://localhost:5173` and the backend on `http://localhost:3001`.

### Environment

**`frontend/.env.local`**

```
VITE_API_URL=http://localhost:3001
```

Points the frontend at the local backend. If omitted, the frontend works client-only (no URL loading, no manifest ID routing).

**`backend/.env`**

```
PORT=3001
DUMPS_DIR=./dumps
ALLOWED_ORIGIN=http://localhost:5173
#AUTH_TOKEN=changeme
```

All values are optional — the defaults above are used if not set. Uncomment `AUTH_TOKEN` to require a token for write endpoints.

### Available scripts

| Command                 | Description                                        |
| ----------------------- | -------------------------------------------------- |
| `npm run dev`           | Start frontend + backend in development mode       |
| `npm run dev:frontend`  | Start frontend only                                |
| `npm run dev:backend`   | Start backend only                                 |
| `npm run build`         | Build the frontend                                 |
| `npm run build:backend` | Compile the backend TypeScript                     |
| `npm run start`         | Start the compiled backend                         |
| `npm run install:all`   | Install dependencies for both frontend and backend |
| `npm run test:all`      | Run frontend and backend test suites               |
| `npm run format`        | Format the codebase with Prettier                  |
| `npm run format:check`  | Check formatting without writing                   |
