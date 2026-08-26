# Security rules

Reference: SPEC.md §49–§52, §76, §85, §86.

- Passwords are hashed with Argon2id. API and agent tokens are stored hashed only.
  Nothing sensitive is ever written in plaintext to the database or the logs.
- Every mutation checks policies before it runs — identically for Studio, REST,
  SDK, CLI and MCP. There is no "trusted" caller.
- Field-level agent permissions are enforced inside the command path, so an agent
  cannot reach a protected field through generic CRUD.
- MCP tools authenticate, then pass agent permissions, policies, field permissions,
  validation, rate limits and audit. Direct database access from a standard MCP
  tool is forbidden.
- Agents never generate raw SQL for standard CMS operations. They express intent as
  commands and Query AST.
- Dynamic resource definitions are untrusted data: declarative JSON only. No
  `eval`, no `new Function`, no executable strings.
- Studio session mutations require CSRF protection; cookies are `httpOnly`,
  `Secure` and `SameSite`. CORS is configured explicitly, never wildcarded.
- Secrets never appear in OpenAPI documents or MCP schemas.
