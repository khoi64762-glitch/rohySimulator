# oyon API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

13 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/addons/oyon/admin/health` | `authenticateToken` | `server/routes/oyon-routes.js:657` |
| `GET` | `/api/addons/oyon/admin/live` | `authenticateToken` | `server/routes/oyon-routes.js:677` |
| `GET` | `/api/addons/oyon/analytics/cases` | `authenticateToken` | `server/routes/oyon-routes.js:516` |
| `GET` | `/api/addons/oyon/analytics/session/:sessionId` | `authenticateToken` | `server/routes/oyon-routes.js:585` |
| `GET` | `/api/addons/oyon/analytics/students` | `authenticateToken` | `server/routes/oyon-routes.js:468` |
| `GET` | `/api/addons/oyon/config` | `authenticateToken` | `server/routes/oyon-routes.js:56` |
| `POST` | `/api/addons/oyon/consent` | `authenticateToken` | `server/routes/oyon-routes.js:178` |
| `GET` | `/api/addons/oyon/emotion-records` | `authenticateToken` | `server/routes/oyon-routes.js:335` |
| `POST` | `/api/addons/oyon/emotion-records` | `authenticateToken` | `server/routes/oyon-routes.js:241` |
| `GET` | `/api/addons/oyon/settings` | `authenticateToken, requireAdmin` | `server/routes/oyon-routes.js:75` |
| `PUT` | `/api/addons/oyon/settings` | `authenticateToken, requireAdmin` | `server/routes/oyon-routes.js:80` |
| `GET` | `/api/addons/oyon/signal-windows` | `authenticateToken` | `server/routes/oyon-routes.js:393` |
| `GET` | `/api/addons/oyon/student/me` | `authenticateToken` | `server/routes/oyon-routes.js:641` |
