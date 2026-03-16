# API Reference

All endpoints are served on the same port as the frontend (default `3001`).

## Authentication

Write endpoints require a token when `AUTH_TOKEN` is configured on the server. Pass it as either:

```
Authorization: Bearer <token>
```

or

```
X-Auth-Token: <token>
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
- **Field:** `file` — the `.zip` file (max 512 MB)
- **Field:** `ttl` _(optional)_ — how long the dump survives on the server, in seconds. Max `31536000` (1 year). Defaults to 1 year.

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
  - `url` — required. Must be a public `http`/`https` address. Private and loopback addresses are blocked (SSRF protection). Up to 5 HTTP redirects are followed; each redirect target is validated against the same rules. Max size: 512 MB.
  - `ttl` _(optional)_ — how long the dump survives on the server, in seconds. Max `31536000` (1 year). Defaults to 1 year.

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

**Response headers:**

| Header         | Description                                                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `X-Expires-At` | ISO 8601 timestamp when the dump will be deleted (e.g. `2027-03-16T12:00:00.000Z`). Present only when a TTL sidecar exists. |

---

## `GET /api/dump/:id/manifest`

Return the parsed `manifest.json` from a stored dump as JSON. **Always public — no auth required.**

```
GET /api/dump/550e8400-e29b-41d4-a716-446655440000/manifest
```

Returns the raw manifest object, including the `hashes` field for v2 dumps. Useful for programmatic access (e.g. building Modrinth/CurseForge/Prism modpacks).

**Response `200`:**

```json
{
  "manifest_version": 2,
  "manifest_id": "550e8400-e29b-41d4-a716-446655440000",
  "versions": { "skyblockbuilder": "2.0", "minecraft": "1.21.1" },
  "hashes": {
    "somemod": { "md5": "abc123", "sha1": "def456", "sha512": "ghi789" }
  },
  "files": []
}
```

Returns `404` if no dump with that id exists, `400` if the id is not a valid UUID v4.

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
