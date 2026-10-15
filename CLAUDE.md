# Driftline instructions

Keep this file and README up to date in the same change whenever behavior, tests, deployment or coverage changes. AGENTS.md is a symlink; preserve it.

- Core engine is `web/engine.mjs`, shared by browser and Node CLI, with no network or dependencies.
- Specs/source code are untrusted text. Never insert input through innerHTML, fetch remote refs, execute uploaded code or persist input by default.
- Preserve input bounds and explicitly report limited coverage. Do not claim no findings proves compatibility. Source matches are candidates, never a verified call graph.
- Tests: `node --test test/*.test.mjs` (Node >=20). Browser uses native modules. No npm install/build step.
- Public GitLab under slop, MIT, signed small commits. Scan for secrets before first push.
- Deployment and live URL will be documented here when installed.
