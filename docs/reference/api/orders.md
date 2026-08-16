# orders API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

37 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `POST` | `/api/cases/:caseId/labs` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:504` |
| `PUT` | `/api/cases/:caseId/labs` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:594` |
| `DELETE` | `/api/cases/:caseId/labs/:labId` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:773` |
| `PUT` | `/api/cases/:caseId/labs/:labId` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:699` |
| `PUT` | `/api/cases/:caseId/treatments` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:2515` |
| `GET` | `/api/cases/:id/investigations` | `authenticateToken` | `server/routes/orders-routes.js:50` |
| `POST` | `/api/investigations` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:64` |
| `GET` | `/api/labs/all` | `authenticateToken` | `server/routes/orders-routes.js:349` |
| `GET` | `/api/labs/group/:groupName` | `authenticateToken` | `server/routes/orders-routes.js:337` |
| `GET` | `/api/labs/grouped` | `authenticateToken` | `server/routes/orders-routes.js:361` |
| `GET` | `/api/labs/groups` | `authenticateToken` | `server/routes/orders-routes.js:327` |
| `POST` | `/api/labs/import` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:456` |
| `POST` | `/api/labs/reload` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:481` |
| `GET` | `/api/labs/search` | `authenticateToken` | `server/routes/orders-routes.js:311` |
| `GET` | `/api/labs/stats` | `authenticateToken, requireReviewer` | `server/routes/orders-routes.js:371` |
| `DELETE` | `/api/labs/test` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:429` |
| `POST` | `/api/labs/test` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:381` |
| `PUT` | `/api/labs/test` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:401` |
| `PUT` | `/api/orders/:id/view` | `authenticateToken` | `server/routes/orders-routes.js:204` |
| `GET` | `/api/radiology-database` | `authenticateToken` | `server/routes/orders-routes.js:1419` |
| `POST` | `/api/sessions/:id/order` | `authenticateToken` | `server/routes/orders-routes.js:79` |
| `GET` | `/api/sessions/:id/orders` | `authenticateToken` | `server/routes/orders-routes.js:134` |
| `GET` | `/api/sessions/:sessionId/active-effects` | `authenticateToken` | `server/routes/orders-routes.js:2394` |
| `POST` | `/api/sessions/:sessionId/administer/:orderId` | `authenticateToken` | `server/routes/orders-routes.js:2060` |
| `GET` | `/api/sessions/:sessionId/available-labs` | `authenticateToken` | `server/routes/orders-routes.js:827` |
| `GET` | `/api/sessions/:sessionId/available-radiology` | `authenticateToken` | `server/routes/orders-routes.js:1454` |
| `GET` | `/api/sessions/:sessionId/available-treatments` | `authenticateToken` | `server/routes/orders-routes.js:1783` |
| `PUT` | `/api/sessions/:sessionId/discontinue/:orderId` | `authenticateToken` | `server/routes/orders-routes.js:2252` |
| `GET` | `/api/sessions/:sessionId/lab-results` | `authenticateToken` | `server/routes/orders-routes.js:1307` |
| `PUT` | `/api/sessions/:sessionId/labs/:labId` | `authenticateToken, requireEducator` | `server/routes/orders-routes.js:1352` |
| `POST` | `/api/sessions/:sessionId/order-labs` | `authenticateToken` | `server/routes/orders-routes.js:989` |
| `POST` | `/api/sessions/:sessionId/order-radiology` | `authenticateToken` | `server/routes/orders-routes.js:1544` |
| `POST` | `/api/sessions/:sessionId/order-treatment` | `authenticateToken` | `server/routes/orders-routes.js:1902` |
| `GET` | `/api/sessions/:sessionId/radiology-orders` | `authenticateToken` | `server/routes/orders-routes.js:1504` |
| `GET` | `/api/sessions/:sessionId/treatment-debrief` | `authenticateToken` | `server/routes/orders-routes.js:2329` |
| `GET` | `/api/sessions/:sessionId/treatment-orders` | `authenticateToken` | `server/routes/orders-routes.js:2287` |
| `GET` | `/api/treatment-effects` | `authenticateToken` | `server/routes/orders-routes.js:2602` |
