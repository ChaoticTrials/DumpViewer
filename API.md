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

### Rate limiting & brute-force protection

All limits are per IP:

| Bucket        | Endpoints                                                                                          | Default limit                     |
| ------------- | -------------------------------------------------------------------------------------------------- | --------------------------------- |
| Upload        | `POST /api/dump/upload`, `POST /api/dump/import`                                                   | 10 / 10 s                         |
| Delete-by-key | `GET`/`POST /api/delete/:key`                                                                      | 10 / 10 s                         |
| General       | `GET /api/dump/:id`, `…/manifest`, `GET /api/dumps`, `DELETE /api/dump/:id`, `PATCH /api/dump/:id` | 100 / 10 s (`GENERAL_RATE_LIMIT`) |
| Modpack       | `GET /api/dump/:id/modpack`                                                                        | 10 / 60 s (`MODPACK_RATE_LIMIT`)  |

Token-gated endpoints additionally share an **auth-failure budget**: only requests answered with `401` count, so legitimate use is never throttled. After `AUTH_FAIL_LIMIT` failures (default 10) within 15 minutes, the IP receives `429` for all token-gated requests — even with a valid token — until the window expires. Failed auth attempts are also delayed by `AUTH_FAIL_DELAY_MS` (default 500 ms) before the `401` is sent.

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
- **Field:** `name` _(optional)_ — display label shown in the admin panel. Trimmed; empty means no name. Max 256 characters. Control, bidi and zero-width characters are rejected with `400`.
- **Field:** `link` _(optional)_ — `http`/`https` URL shown in the admin panel (e.g. the issue this dump came from). Trimmed; empty means no link. Max 2048 characters. Any other scheme is rejected with `400`.

Both metadata fields are validated before anything is written to disk, so an invalid value never stores a dump.

**Response `200`:**

```json
{ "id": "550e8400-e29b-41d4-a716-446655440000", "deleteKey": "<base64url-encoded key>" }
```

The `id` is the `manifest_id` from `manifest.json` inside the zip (UUID v4). The `deleteKey` can be used with `GET`/`POST /api/delete/:key` to delete the dump later without the server auth token.

Re-uploading a zip with the same `manifest_id` replaces the stored dump **and rewrites its sidecar wholesale** — `name`/`link` not sent with the new upload are cleared. Use `PATCH /api/dump/:id` to change metadata without re-uploading.

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

# Upload with a name and a link back to the issue it came from
curl -X POST http://localhost:3001/api/dump/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@my-dump.zip" \
  -F "name=Issue #412" \
  -F "link=https://github.com/o/r/issues/412"
```

---

## `POST /api/dump/import`

Fetch a dump zip from a remote URL and store it on the server.

- **Auth:** required if `AUTH_TOKEN` is set
- **Content-Type:** `application/json`
- **Body:** `{ "url": "https://example.com/dump.zip", "ttl": 604800, "name": "Issue #412", "link": "https://github.com/o/r/issues/412" }`
  - `url` — required. Must be a public `http`/`https` address. Private and loopback addresses are blocked (SSRF protection). Up to 5 HTTP redirects are followed; each redirect target is validated against the same rules. Max size: 512 MB.
  - `ttl` _(optional)_ — how long the dump survives on the server, in seconds. Max `31536000` (1 year). Defaults to 1 year.
  - `name` _(optional)_ — display label shown in the admin panel. Trimmed; empty or `null` means no name. Max 256 characters. Control, bidi and zero-width characters are rejected with `400`.
  - `link` _(optional)_ — `http`/`https` URL shown in the admin panel. Trimmed; empty or `null` means no link. Max 2048 characters. Any other scheme is rejected with `400`. Unlike `url`, this link is never fetched by the server, so loopback and private addresses are allowed.

`name` and `link` are validated **before** the remote fetch starts, so a bad value fails immediately instead of after a large download. As with upload, re-importing the same `manifest_id` rewrites the sidecar wholesale.

**Response `200`:**

```json
{ "id": "550e8400-e29b-41d4-a716-446655440000", "deleteKey": "<base64url-encoded key>" }
```

**curl example:**

```bash
# Import with a 24-hour TTL
curl -X POST http://localhost:3001/api/dump/import \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/dump.zip", "ttl": 86400}'

# Import with metadata
curl -X POST http://localhost:3001/api/dump/import \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/dump.zip", "name": "Issue #412", "link": "https://github.com/o/r/issues/412"}'
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
| `Expires`      | Same timestamp in HTTP-date format, for caches. Present only when a TTL sidecar exists.                                     |

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

## `PATCH /api/dump/:id`

Update a stored dump's display metadata. The dump zip itself is never touched.

- **Auth:** required if `AUTH_TOKEN` is set
- **Content-Type:** `application/json`
- **Body:** `{ "name": "Issue #412", "link": "https://github.com/o/r/issues/412" }`
  - `name` _(optional)_ — same rules as on upload: trimmed, max 256 characters, no control/bidi/zero-width characters.
  - `link` _(optional)_ — same rules as on import: trimmed, max 2048 characters, `http`/`https` only. Never fetched by the server.

This is a **partial** update:

| Body                   | Effect                         |
| ---------------------- | ------------------------------ |
| key omitted            | field left untouched           |
| `"name": null`         | field cleared                  |
| `"name": ""`           | field cleared (same as `null`) |
| `"name": "Issue #412"` | field set to the trimmed value |

At least one of `name`/`link` must be present. Unknown keys in the body are ignored.

**Response `200`:** the normalized stored values, so a client can merge them without refetching the list.

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Issue #412",
  "link": "https://github.com/o/r/issues/412"
}
```

**Response `400`:** invalid id, neither field present, or a value that failed validation. A rejected request leaves the stored metadata untouched.

**Response `404`:** no dump with that id.

**curl example:**

```bash
# Set both fields
curl -X PATCH http://localhost:3001/api/dump/550e8400-e29b-41d4-a716-446655440000 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Issue #412", "link": "https://github.com/o/r/issues/412"}'

# Clear just the link, leaving the name alone
curl -X PATCH http://localhost:3001/api/dump/550e8400-e29b-41d4-a716-446655440000 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"link": null}'
```

---

## `GET /api/delete/:key`

Show a confirmation page for deleting a stored dump using the delete key returned by the upload or import endpoint. **No auth token required** — the key itself is the credential. Rate limited.

```
GET /api/delete/<deleteKey>
```

The key encodes the dump id using the server's RSA private key. The server recovers the id from the key and, if the dump exists, returns an HTML page with a delete button. The actual deletion happens via `POST /api/delete/:key` (the page's form submits to the same URL), so opening the link — or a link prefetcher following it — never deletes anything by itself.

**Response `200`:** HTML confirmation page

**Response `400`:** `Invalid delete key` — key could not be decoded or did not contain a valid id

**Response `404`:** `Not found` — key is valid but the dump no longer exists (already deleted or expired)

---

## `POST /api/delete/:key`

Delete a stored dump using its delete key. **No auth token required** — the key itself is the credential. Rate limited.

**Response `200`:** `Deleted` (plain text)

**Response `400`:** `Invalid delete key` — key could not be decoded or did not contain a valid id

**Response `404`:** `Not found` — key is valid but the dump no longer exists (already deleted or expired)

**curl example:**

```bash
curl -X POST http://localhost:3001/api/delete/<deleteKey>
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
      "expiresAt": "2026-01-01T00:00:00.000Z",
      "manifestVersion": 2,
      "versions": {
        "skyblockbuilder": "2.0",
        "minecraft": "1.21.1",
        "neoforge": "21.1.80"
      },
      "name": "Issue #412",
      "link": "https://github.com/o/r/issues/412"
    }
  ]
}
```

`manifestVersion` is the dump's manifest format version and `versions` is the full `versions` object from the manifest (all mod versions, stored verbatim). Both are `null` if the zip or its manifest is unreadable. The fields are recorded in the `.meta` sidecar at upload time; for dumps stored before this field existed they are extracted from the zip and backfilled into the sidecar on the first listing.

`name` and `link` are the optional display metadata set at upload/import time or via `PATCH /api/dump/:id`. Both are `null` when unset — there is nothing to compute, so unlike `manifestVersion` they are never backfilled into old sidecars.

**curl example:**

```bash
curl http://localhost:3001/api/dumps \
  -H "Authorization: Bearer $TOKEN"
```
