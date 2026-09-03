---
name: Cookie-auth smoke tests
description: Durable guidance for validating cookie-backed authentication in full-stack workspace apps.
---

Cookie-backed authentication should be tested end to end from login through at least one protected request. A successful login response can still hide a missing cookie parser, incorrect cookie transport flags, or a proxy/path mismatch.

**Why:** A marketplace smoke test initially showed that the server could issue a JWT cookie but protected routes still returned 401 because the Express cookie parser was not mounted. A second isolated test also exposed that Secure cookies are not sent over plain HTTP, which is expected but easy to misread in local curl checks.

**How to apply:** Test with the same protocol and environment mode as the preview when possible. For a temporary local process, use a process-only JWT value and development cookie settings without persisting or displaying secrets. Assert login, one protected read, one mutation, and logout behavior.