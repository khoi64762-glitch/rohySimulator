# treatments-library API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

4 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `POST` | `/api/treatment-effects` | `authenticateToken, requireEducator` | `server/routes/treatments-library-routes.js:193` |
| `DELETE` | `/api/treatment-effects/:id` | `authenticateToken, requireEducator` | `server/routes/treatments-library-routes.js:323` |
| `PUT` | `/api/treatment-effects/:id` | `authenticateToken, requireEducator` | `server/routes/treatments-library-routes.js:238` |
| `PUT` | `/api/treatment-effects/:id/restore` | `authenticateToken, requireEducator` | `server/routes/treatments-library-routes.js:326` |
