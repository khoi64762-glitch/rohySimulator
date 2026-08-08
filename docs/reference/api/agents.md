# agents API

> **Generated file — do not hand-edit.** Produced from `server/routes/*.js`
> by `scripts/docs-gen/gen-api.mjs`. Regenerate with `npm run docs:gen:api`.

23 endpoints. All paths are
relative to the `/api` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
| `GET` | `/api/agents/templates` | `authenticateToken` | `server/routes/agents-routes.js:46` |
| `POST` | `/api/agents/templates` | `authenticateToken, requireEducator` | `server/routes/agents-routes.js:104` |
| `DELETE` | `/api/agents/templates/:id` | `authenticateToken, requireEducator` | `server/routes/agents-routes.js:314` |
| `GET` | `/api/agents/templates/:id` | `authenticateToken` | `server/routes/agents-routes.js:73` |
| `PUT` | `/api/agents/templates/:id` | `authenticateToken, requireEducator` | `server/routes/agents-routes.js:181` |
| `POST` | `/api/agents/templates/:id/duplicate` | `authenticateToken, requireEducator` | `server/routes/agents-routes.js:654` |
| `POST` | `/api/agents/templates/:id/reset-to-default` | `authenticateToken, requireEducator` | `server/routes/agents-routes.js:389` |
| `POST` | `/api/agents/templates/:id/test-llm` | `authenticateToken, requireEducator` | `server/routes/agents-routes.js:504` |
| `GET` | `/api/cases/:caseId/agents` | `authenticateToken` | `server/routes/agents-routes.js:732` |
| `POST` | `/api/cases/:caseId/agents` | `authenticateToken, requireEducator` | `server/routes/agents-routes.js:794` |
| `DELETE` | `/api/cases/:caseId/agents/:agentId` | `authenticateToken, requireEducator` | `server/routes/agents-routes.js:946` |
| `PUT` | `/api/cases/:caseId/agents/:agentId` | `authenticateToken, requireEducator` | `server/routes/agents-routes.js:873` |
| `POST` | `/api/cases/:caseId/agents/add-defaults` | `authenticateToken, requireEducator` | `server/routes/agents-routes.js:986` |
| `GET` | `/api/sessions/:sessionId/agents` | `authenticateToken` | `server/routes/agents-routes.js:1059` |
| `POST` | `/api/sessions/:sessionId/agents/:agentType/arrive` | `authenticateToken` | `server/routes/agents-routes.js:1288` |
| `DELETE` | `/api/sessions/:sessionId/agents/:agentType/conversation` | `authenticateToken` | `server/routes/agents-routes.js:1431` |
| `GET` | `/api/sessions/:sessionId/agents/:agentType/conversation` | `authenticateToken` | `server/routes/agents-routes.js:1375` |
| `POST` | `/api/sessions/:sessionId/agents/:agentType/conversation` | `authenticateToken` | `server/routes/agents-routes.js:1401` |
| `POST` | `/api/sessions/:sessionId/agents/:agentType/depart` | `authenticateToken` | `server/routes/agents-routes.js:1315` |
| `POST` | `/api/sessions/:sessionId/agents/:agentType/page` | `authenticateToken` | `server/routes/agents-routes.js:1197` |
| `GET` | `/api/sessions/:sessionId/agents/:agentType/status` | `authenticateToken` | `server/routes/agents-routes.js:1340` |
| `GET` | `/api/sessions/:sessionId/team-communications` | `authenticateToken` | `server/routes/agents-routes.js:1457` |
| `POST` | `/api/sessions/:sessionId/team-communications` | `authenticateToken` | `server/routes/agents-routes.js:1483` |
