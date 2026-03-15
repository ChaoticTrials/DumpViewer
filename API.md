# API Reference

All endpoints are served on the same port as the frontend (default `3001`).

## Authentication

Write endpoints require a token when `AUTH_TOKEN` is configured on the server. Pass it as either:

```
Authorization: Bearer <token>
```
or
```
X-Upload-Token: <token>
```

If `AUTH_TOKEN` is empty, all write endpoints are open. Read endpoints are always public.

---

## `GET /health`

Health check.

**Response `200`:** `{ "ok": true }`

---

## `POST /api/dump/upload`

Upload a dump zip from disk.

- **Auth:** required if `AUTH_TOKEN` is set
- **Content-Type:** `multipart/form-data`
- **Field:** `file` — the `.zip` file (max 256 MB)
- **Field:** `ttl` *(optional)* — how long the dump survives on the server, in seconds. Max `31536000` (1 year). Defaults to 1 year.

**Response `200`:**
```json
{ "id": "550e8400-e29b-41d4-a716-446655440000", "url": "/api/dump/550e8400-e29b-41d4-a716-446655440000" }
```

The `id` is the `manifest_id` from `manifest.json` inside the zip (UUID v4). The `url` is the path to download the raw zip from this server. The viewer is at `/<id>`.

**curl example:**
```bash
# Upload with default TTL (1 year)
curl -X POST http://localhost:3001/api/dump/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@my-dump.zip"

# Upload with a 7-day TTL
curl -X POST http://localhost:3001/api/dump/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@my-dump.zip" \
  -F "ttl=604800"
```

---

## `POST /api/dump/import`

Fetch a dump zip from a remote URL and store it on the server.

- **Auth:** required if `AUTH_TOKEN` is set
- **Content-Type:** `application/json`
- **Body:** `{ "url": "https://example.com/dump.zip", "ttl": 604800 }`
  - `url` — required. Must be a public `http`/`https` address. Private and loopback addresses are blocked (SSRF protection). HTTP redirects are not followed. Max size: 256 MB.
  - `ttl` *(optional)* — how long the dump survives on the server, in seconds. Max `31536000` (1 year). Defaults to 1 year.

**Response `200`:**
```json
{ "id": "550e8400-e29b-41d4-a716-446655440000", "url": "/api/dump/550e8400-e29b-41d4-a716-446655440000" }
```

**curl example:**
```bash
# Import with a 24-hour TTL
curl -X POST http://localhost:3001/api/dump/import \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/dump.zip", "ttl": 86400}'
```

---

## `GET /api/dump/:id`

Download the raw zip for a stored dump. **Always public — no auth required.**

```
GET /api/dump/550e8400-e29b-41d4-a716-446655440000
```

Returns the zip with `Content-Type: application/zip`. Returns `404` if no dump with that id exists, `400` if the id is not a valid UUID v4.

---

## `DELETE /api/dump/:id`

Delete a stored dump.

- **Auth:** required if `AUTH_TOKEN` is set

**Response:** `204 No Content` on success.

**curl example:**
```bash
curl -X DELETE http://localhost:3001/api/dump/550e8400-e29b-41d4-a716-446655440000 \
  -H "Authorization: Bearer $TOKEN"
```

---

## `GET /api/dumps`

List all stored dumps, sorted newest first.

- **Auth:** required if `AUTH_TOKEN` is set

**Response `200`:**
```json
{
  "dumps": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "size": 4096,
      "createdAt": "2025-01-01T00:00:00.000Z",
      "expiresAt": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

**curl example:**
```bash
curl http://localhost:3001/api/dumps \
  -H "Authorization: Bearer $TOKEN"
```
