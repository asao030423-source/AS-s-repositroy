# Contributor guidance

- Build a Codex companion, with Windows and official subscription quota as the first supported path.
- Prefer small, readable changes. Reuse existing code and platform APIs; do not add frameworks for hypothetical extensions.
- Keep account data, credentials, conversations and machine-specific paths out of source control and reports. Tests use synthetic data.
- Preserve real sample timestamps and account isolation. A failed request must never become a fabricated zero or a fresh sample.
- Add focused tests for meaningful new behavior or regressions, not implementation details or trivial edits. Run `npm test` and `npm run check` for runtime changes.
- Do not alter the user's Codex configuration or the separately installed upstream widget.
- Keep upstream attribution. Document runtime dependencies and unverified platform behavior honestly.
