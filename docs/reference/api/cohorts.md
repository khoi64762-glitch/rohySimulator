# cohorts API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

31 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/cohorts` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:228` |
| `POST` | `/api/cohorts` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:124` |
| `DELETE` | `/api/cohorts/:id` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:375` |
| `GET` | `/api/cohorts/:id` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:262` |
| `PATCH` | `/api/cohorts/:id` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:304` |
| `GET` | `/api/cohorts/:id/analytics/filter-options` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1445` |
| `GET` | `/api/cohorts/:id/analytics/hourly-counts` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1804` |
| `GET` | `/api/cohorts/:id/analytics/pulse` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1488` |
| `GET` | `/api/cohorts/:id/analytics/stats` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1815` |
| `GET` | `/api/cohorts/:id/analytics/summary` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1782` |
| `GET` | `/api/cohorts/:id/analytics/timeline-series` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1793` |
| `GET` | `/api/cohorts/:id/analytics/tna-sequences` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1838` |
| `GET` | `/api/cohorts/:id/analytics/top-resources` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1826` |
| `POST` | `/api/cohorts/:id/cases` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:531` |
| `DELETE` | `/api/cohorts/:id/cases/:caseId` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:632` |
| `PATCH` | `/api/cohorts/:id/cases/:caseId` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:659` |
| `GET` | `/api/cohorts/:id/export` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1334` |
| `GET` | `/api/cohorts/:id/feed` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1283` |
| `GET` | `/api/cohorts/:id/grid` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1170` |
| `DELETE` | `/api/cohorts/:id/join-code` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:952` |
| `POST` | `/api/cohorts/:id/join-code` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:933` |
| `POST` | `/api/cohorts/:id/members` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:461` |
| `DELETE` | `/api/cohorts/:id/members/:userId` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:496` |
| `PATCH` | `/api/cohorts/:id/members/:userId` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:714` |
| `POST` | `/api/cohorts/:id/members/bulk` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:768` |
| `GET` | `/api/cohorts/:id/roster` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1124` |
| `GET` | `/api/cohorts/:id/student/:userId` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:1221` |
| `POST` | `/api/cohorts/:id/teachers` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:871` |
| `DELETE` | `/api/cohorts/:id/teachers/:userId` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:904` |
| `POST` | `/api/cohorts/bulk-enroll` | `authenticateToken, requireEducator` | `server/routes/cohorts-routes.js:807` |
| `POST` | `/api/cohorts/join` | `authenticateToken, requireStudent` | `server/routes/cohorts-routes.js:968` |
