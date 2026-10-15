# Driftline

Compare two OpenAPI JSON contracts, locate candidate client references, and export an actionable migration plan. Same dependency-free comparison engine in the browser and Node CLI. Browser inputs stay in memory on your device: no upload endpoint, analytics, storage or external fonts.

## Run

Node 20+ for CLI/tests (no npm install needed):

```sh
node --test test/*.test.mjs
node bin/driftline.mjs examples/before.json examples/after.json --format markdown
node bin/driftline.mjs old.json new.json --source ./src --format json --fail-on review > migration.json
```

Exit 0 passes threshold, 1 findings at threshold or incomplete analysis, 2 invalid input. Default threshold `breaking`; `review` also fails on manual-review findings; `never` always reports without a CI failure. Exports may contain source excerpts; review before sharing. Source scans skip hidden files/directories, symlinks, build/vendor/dependency directories and binary files; supported source extensions are listed in `bin/driftline.mjs`. Non-source files are ignored. References are text matches, not proven usages; absence of a match does not prove an endpoint is unused.

## Coverage

OpenAPI 3.0.x and 3.1.x, JSON only. Local JSON pointer refs, operations, inherited parameters and overrides, parameter required/type/enum/serialization changes, request body requirements, media types, response statuses, response properties and guarantees, object/array schemas, numeric/string/array bounds, additional properties, auth definitions/scopes, server URLs, deprecations and SDK operation names. Request narrowing and response widening are evaluated in opposite directions.

Complex compositions (allOf/oneOf/anyOf/not and conditional/dynamic constructs), external/unresolved refs, changed unhandled schema keywords and certain contract changes produce manual-review findings. No external refs are fetched. This is a heuristic migration assistant, not a complete OpenAPI validator or formal compatibility proof. It does not automatically fix code, call APIs, use an LLM or create pull requests. New optional response fields are classified compatible for tolerant clients; strict decoders/generated clients may need additional review. Unknown fields beyond the documented comparisons may not be checked. Review warnings and run real consumer tests before shipping.

Limits: 5 MiB per spec, 2,000 paths, 48 schema levels, 5,000 findings; source scan 1,000 files / 10 MiB total / 1 MiB per file; 100 candidate references per finding. CLI traversal has a 50,000-entry cap. Limits are reported rather than silently returning a clean result. Specs must be valid OpenAPI inputs; malformed nested structures may produce an input error.

MIT, by slop. Market research and product hypothesis: [docs/research.md](docs/research.md).
