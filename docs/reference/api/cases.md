# cases API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

17 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/cases` | `authenticateToken` | `server/routes/cases-routes.js:78` |
| `POST` | `/api/cases` | `authenticateToken, requireEducator` | `server/routes/cases-routes.js:262` |
| `POST` | `/api/cases/:caseId/restore/:versionId` | `authenticateToken, requireAdmin` | `server/routes/cases-routes.js:943` |
| `GET` | `/api/cases/:caseId/versions` | `authenticateToken, requireAdmin` | `server/routes/cases-routes.js:925` |
| `DELETE` | `/api/cases/:id` | `authenticateToken, requireEducator` | `server/routes/cases-routes.js:469` |
| `GET` | `/api/cases/:id` | `authenticateToken` | `server/routes/cases-routes.js:153` |
| `PUT` | `/api/cases/:id` | `authenticateToken, requireEducator` | `server/routes/cases-routes.js:364` |
| `PUT` | `/api/cases/:id/availability` | `authenticateToken, requireEducator` | `server/routes/cases-routes.js:185` |
| `PUT` | `/api/cases/:id/default` | `authenticateToken, requireEducator` | `server/routes/cases-routes.js:211` |
| `GET` | `/api/scenarios` | `authenticateToken` | `server/routes/cases-routes.js:510` |
| `POST` | `/api/scenarios` | `authenticateToken` | `server/routes/cases-routes.js:591` |
| `DELETE` | `/api/scenarios/:id` | `authenticateToken` | `server/routes/cases-routes.js:684` |
| `GET` | `/api/scenarios/:id` | `authenticateToken` | `server/routes/cases-routes.js:537` |
| `PUT` | `/api/scenarios/:id` | `authenticateToken` | `server/routes/cases-routes.js:632` |
| `POST` | `/api/scenarios/seed` | `authenticateToken, requireAdmin` | `server/routes/cases-routes.js:716` |
| `GET` | `/api/sessions/:sessionId/exam-findings` | `authenticateToken` | `server/routes/cases-routes.js:907` |
| `POST` | `/api/sessions/:sessionId/exam-findings` | `authenticateToken` | `server/routes/cases-routes.js:844` |
