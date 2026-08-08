# orders API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

37 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `POST` | `/api/cases/:caseId/labs` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:502` |
| `PUT` | `/api/cases/:caseId/labs` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:592` |
| `DELETE` | `/api/cases/:caseId/labs/:labId` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:771` |
| `PUT` | `/api/cases/:caseId/labs/:labId` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:697` |
| `PUT` | `/api/cases/:caseId/treatments` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:2404` |
| `GET` | `/api/cases/:id/investigations` | `authenticateToken` | `server/routes/orders-routes.js:48` |
| `POST` | `/api/investigations` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:62` |
| `GET` | `/api/labs/all` | `authenticateToken` | `server/routes/orders-routes.js:347` |
| `GET` | `/api/labs/group/:groupName` | `authenticateToken` | `server/routes/orders-routes.js:335` |
| `GET` | `/api/labs/grouped` | `authenticateToken` | `server/routes/orders-routes.js:359` |
| `GET` | `/api/labs/groups` | `authenticateToken` | `server/routes/orders-routes.js:325` |
| `POST` | `/api/labs/import` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:454` |
| `POST` | `/api/labs/reload` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:479` |
| `GET` | `/api/labs/search` | `authenticateToken` | `server/routes/orders-routes.js:309` |
| `GET` | `/api/labs/stats` | `authenticateToken, requireReviewer` | `server/routes/orders-routes.js:369` |
| `DELETE` | `/api/labs/test` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:427` |
| `POST` | `/api/labs/test` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:379` |
| `PUT` | `/api/labs/test` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:399` |
| `PUT` | `/api/orders/:id/view` | `authenticateToken` | `server/routes/orders-routes.js:202` |
| `GET` | `/api/radiology-database` | `authenticateToken` | `server/routes/orders-routes.js:1411` |
| `POST` | `/api/sessions/:id/order` | `authenticateToken` | `server/routes/orders-routes.js:77` |
| `GET` | `/api/sessions/:id/orders` | `authenticateToken` | `server/routes/orders-routes.js:132` |
| `GET` | `/api/sessions/:sessionId/active-effects` | `authenticateToken` | `server/routes/orders-routes.js:2283` |
| `POST` | `/api/sessions/:sessionId/administer/:orderId` | `authenticateToken` | `server/routes/orders-routes.js:1950` |
| `GET` | `/api/sessions/:sessionId/available-labs` | `authenticateToken` | `server/routes/orders-routes.js:825` |
| `GET` | `/api/sessions/:sessionId/available-radiology` | `authenticateToken` | `server/routes/orders-routes.js:1446` |
| `GET` | `/api/sessions/:sessionId/available-treatments` | `authenticateToken` | `server/routes/orders-routes.js:1740` |
| `PUT` | `/api/sessions/:sessionId/discontinue/:orderId` | `authenticateToken` | `server/routes/orders-routes.js:2142` |
| `GET` | `/api/sessions/:sessionId/lab-results` | `authenticateToken` | `server/routes/orders-routes.js:1299` |
| `PUT` | `/api/sessions/:sessionId/labs/:labId` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:1344` |
| `POST` | `/api/sessions/:sessionId/order-labs` | `authenticateToken` | `server/routes/orders-routes.js:984` |
| `POST` | `/api/sessions/:sessionId/order-radiology` | `authenticateToken` | `server/routes/orders-routes.js:1536` |
| `POST` | `/api/sessions/:sessionId/order-treatment` | `authenticateToken` | `server/routes/orders-routes.js:1828` |
| `GET` | `/api/sessions/:sessionId/radiology-orders` | `authenticateToken` | `server/routes/orders-routes.js:1496` |
| `GET` | `/api/sessions/:sessionId/treatment-debrief` | `authenticateToken` | `server/routes/orders-routes.js:2219` |
| `GET` | `/api/sessions/:sessionId/treatment-orders` | `authenticateToken` | `server/routes/orders-routes.js:2177` |
| `GET` | `/api/treatment-effects` | `authenticateToken` | `server/routes/orders-routes.js:2486` |
