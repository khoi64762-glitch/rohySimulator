# cases API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

17 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/cases` | `authenticateToken` | `server/routes/cases-routes.js:104` |
| `POST` | `/api/cases` | `authenticateToken, requireEducator` | `server/routes/cases-routes.js:288` |
| `POST` | `/api/cases/:caseId/restore/:versionId` | `authenticateToken, requireAdmin` | `server/routes/cases-routes.js:973` |
| `GET` | `/api/cases/:caseId/versions` | `authenticateToken, requireAdmin` | `server/routes/cases-routes.js:955` |
| `DELETE` | `/api/cases/:id` | `authenticateToken, requireEducator` | `server/routes/cases-routes.js:499` |
| `GET` | `/api/cases/:id` | `authenticateToken` | `server/routes/cases-routes.js:179` |
| `PUT` | `/api/cases/:id` | `authenticateToken, requireEducator` | `server/routes/cases-routes.js:392` |
| `PUT` | `/api/cases/:id/availability` | `authenticateToken, requireEducator` | `server/routes/cases-routes.js:211` |
| `PUT` | `/api/cases/:id/default` | `authenticateToken, requireEducator` | `server/routes/cases-routes.js:237` |
| `GET` | `/api/scenarios` | `authenticateToken` | `server/routes/cases-routes.js:540` |
| `POST` | `/api/scenarios` | `authenticateToken` | `server/routes/cases-routes.js:621` |
| `DELETE` | `/api/scenarios/:id` | `authenticateToken` | `server/routes/cases-routes.js:714` |
| `GET` | `/api/scenarios/:id` | `authenticateToken` | `server/routes/cases-routes.js:567` |
| `PUT` | `/api/scenarios/:id` | `authenticateToken` | `server/routes/cases-routes.js:662` |
| `POST` | `/api/scenarios/seed` | `authenticateToken, requireAdmin` | `server/routes/cases-routes.js:746` |
| `GET` | `/api/sessions/:sessionId/exam-findings` | `authenticateToken` | `server/routes/cases-routes.js:937` |
| `POST` | `/api/sessions/:sessionId/exam-findings` | `authenticateToken` | `server/routes/cases-routes.js:874` |
