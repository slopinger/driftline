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

## Browser app

Serve `web/` with any static web server, for example `python3 -m http.server 8891 --bind 127.0.0.1 --directory web`, then open http://127.0.0.1:8891. Native ES modules and a module worker need HTTP(S), not a file:// URL. The synthetic Orbit example loads automatically. Replace contracts by pasting, file pickers or drag/drop; add optional client source files, analyze, filter findings and export Markdown/JSON. Analysis runs in a worker so it can be cancelled by editing inputs. No data is stored in localStorage or sent to an analysis service; only static assets and the bundled synthetic example are requested. Large reports/source scans can take time.

## Deployment

Public app: https://driftline.freifick.net. Source: https://github.com/slopinger/driftline.

On our Arch host, `./deploy.sh` runs tests and installs the committed `web/` directory as an immutable release at `/srv/http/driftline/releases/<commit>`, then atomically switches `/srv/http/driftline/current`. Requires Node >=20, sudo and the host's existing Caddy security-header snippet; when Node is not on PATH use `nix shell nixpkgs#nodejs --command ./deploy.sh`. Installs `/etc/caddy/conf.d/driftline.freifick.net.caddy`, validates the full Caddy config, then reloads Caddy. Validation failure restores the previous config. Old releases remain for rollback; no server process, application data, keys or backup job is needed. DNS A/AAAA are DNS-only to this host. The app never contacts the described APIs.

To roll back, point `current` at a previously verified release using an atomic symlink replacement. Caddy serves through the symlink without a reload; if changing site config, validate then reload Caddy. Keep releases root-owned and readable by Caddy.

Optional browser QA: serve `web/`, then run `node test/browser.mjs` with Playwright available. `PLAYWRIGHT_MODULE` may be an absolute path to an existing Playwright module, `CHROMIUM_BIN` an installed Chromium executable, and `BASE_URL` a local or live app URL ending in `/`. Screenshots go to ignored `artifacts/`. The QA covers desktop/390px/320px, worker analysis, filters, invalid JSON and stale-report cancellation, source selection, export, untrusted text and absence of external requests.

## Nix

`nix build` packages the CLI and static website and runs the Node regression suite
in the build sandbox. `nix run . -- --help` runs the CLI; `nix develop` provides
Node and Python. `nix flake check` builds the package check. Linux x86_64 and
aarch64 are supported. Static assets are in `result/share/driftline/web`.

For NixOS, import `inputs.driftline.nixosModules.default` and set
`services.driftline.enable = true;` and `services.driftline.domain = "example.org";`.
The module configures Caddy; arrange DNS and firewall ports 80/443 on the host.
The package can be overridden with `services.driftline.package`. Existing Arch
deployment continues to use `./deploy.sh`.
