# registration API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

8 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/auth/invite/:token` | `(none)` | `server/routes/registration-routes.js:55` |
| `GET` | `/api/registration-invites` | `authenticateToken, requireAdmin` | `server/routes/registration-routes.js:165` |
| `POST` | `/api/registration-invites` | `authenticateToken, requireAdmin` | `server/routes/registration-routes.js:86` |
| `DELETE` | `/api/registration-invites/:id` | `authenticateToken, requireAdmin` | `server/routes/registration-routes.js:190` |
| `GET` | `/api/registration-invites/:id/uses` | `authenticateToken, requireAdmin` | `server/routes/registration-routes.js:217` |
| `GET` | `/api/registration-requests` | `authenticateToken, requireAdmin` | `server/routes/registration-routes.js:250` |
| `POST` | `/api/registration-requests/:id/approve` | `authenticateToken, requireAdmin` | `server/routes/registration-routes.js:276` |
| `POST` | `/api/registration-requests/:id/reject` | `authenticateToken, requireAdmin` | `server/routes/registration-routes.js:350` |
