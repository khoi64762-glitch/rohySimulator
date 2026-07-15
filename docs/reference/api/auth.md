# auth API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

7 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `POST` | `/api/auth/login` | `(none)` | `server/routes/auth-routes.js:431` |
| `POST` | `/api/auth/logout` | `authenticateToken` | `server/routes/auth-routes.js:718` |
| `GET` | `/api/auth/profile` | `authenticateToken` | `server/routes/auth-routes.js:701` |
| `POST` | `/api/auth/refresh` | `authenticateToken` | `server/routes/auth-routes.js:635` |
| `POST` | `/api/auth/register` | `(none)` | `server/routes/auth-routes.js:159` |
| `GET` | `/api/auth/registration-policy` | `(none)` | `server/routes/auth-routes.js:133` |
| `GET` | `/api/auth/verify` | `authenticateToken` | `server/routes/auth-routes.js:602` |
