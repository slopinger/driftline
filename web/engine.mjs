// Shared browser/CLI engine. No I/O, dependencies, remote refs or code execution.
const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
const own = (o, k) => Object.prototype.hasOwnProperty.call(o ?? {}, k);
const object = o => !!o && typeof o === 'object' && !Array.isArray(o);
const sorted = value => Array.isArray(value) ? value.map(sorted) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map(k => [k, sorted(value[k])])) : value;
const stable = value => JSON.stringify(sorted(value));
const equal = (a, b) => stable(a) === stable(b);
const brief = value => value === undefined ? 'not specified' : stable(value);
const ptr = value => String(value).replaceAll('~', '~0').replaceAll('/', '~1');
const MAX_FINDINGS = 5000;

export function parseSpec(text, label = 'Specification') {
  if (text.length > 5 * 1024 * 1024) throw new Error(`${label}: limit is 5 MiB of JSON text.`);
  let spec;
  try { spec = JSON.parse(text); } catch { throw new Error(`${label}: invalid JSON. Export YAML as JSON first.`); }
  if (!object(spec) || !/^3\.[01]\.\d+$/.test(spec.openapi ?? ''))
    throw new Error(`${label}: supported versions are OpenAPI 3.0.x and 3.1.x.`);
  if (!object(spec.paths)) throw new Error(`${label}: paths must be an object.`);
  if (Object.keys(spec.paths).length > 2000) throw new Error(`${label}: limit is 2,000 paths.`);
  return spec;
}

function resolve(spec, value) {
  const seen = new Set();
  while (object(value) && own(value, '$ref')) {
    const ref = value.$ref;
    if (typeof ref !== 'string' || !ref.startsWith('#/')) throw new Error(`Reference requires review: ${brief(ref)}`);
    if (seen.has(ref)) throw new Error(`Recursive reference: ${ref}`);
    seen.add(ref);
    let target = spec;
    for (const part of ref.slice(2).split('/').map(p => p.replaceAll('~1', '/').replaceAll('~0', '~'))) {
      if (!object(target) || !own(target, part)) throw new Error(`Unresolved reference: ${ref}`);
      target = target[part];
    }
    // Ref siblings have version/context-specific semantics; do not silently merge them.
    const extra = Object.keys(value).filter(k => !['$ref', 'description', 'summary'].includes(k));
    if (extra.length) throw new Error(`Reference siblings require review: ${extra.join(', ')}`);
    value = target;
  }
  return value;
}

export function compareSpecs(before, after) {
  // Also validate objects passed by callers rather than only UI/CLI JSON.
  parseSpec(JSON.stringify(before), 'Before'); parseSpec(JSON.stringify(after), 'After');
  const findings = []; const ids = new Set(); let truncated = false;
  let context = {method: 'API', path: '/', operationId: ''};
  function add(severity, rule, location, title, oldValue, newValue, action) {
    const id = stable([rule, context.method, context.path, location]);
    if (ids.has(id)) return;
    if (findings.length >= MAX_FINDINGS) { truncated = true; return; }
    ids.add(id);
    findings.push({id, severity, rule, ...context, location, title,
      before: brief(oldValue), after: brief(newValue), action});
  }
  function review(location, message, oldValue, newValue) {
    add('review', 'manual-review', location, message, oldValue, newValue,
      'Inspect the referenced contract and test the affected client before shipping.');
  }
  function unwrap(a, b, location) {
    try { return [resolve(before, a), resolve(after, b)]; }
    catch (error) { review(location, error.message, a, b); return null; }
  }
  function schema(a, b, direction, location, depth = 0, ancestors = []) {
    const pair = unwrap(a, b, location); if (!pair) return;
    [a, b] = pair;
    if (depth > 48) { review(location, 'Schema depth limit reached', a, b); return; }
    if (ancestors.some(([x, y]) => x === a && y === b)) return;
    const next = [...ancestors, [a, b]];
    if (a === undefined && b === undefined) return;
    if (!object(a) || !object(b)) {
      if (!equal(a, b)) review(location, 'Schema added, removed or boolean schema changed', a, b);
      return;
    }
    const request = direction === 'request';
    const breaking = (rule, title, x, y, action) => add('breaking', rule, location, title, x, y, action);
    const types = s => new Set([...(Array.isArray(s.type) ? s.type : s.type ? [s.type] : []), ...(s.nullable ? ['null'] : [])]);
    const at = types(a), bt = types(b);
    if (!equal([...at].sort(), [...bt].sort())) {
      // Untyped means unconstrained; integer is accepted wherever number is accepted.
      const accepts = (set, t) => !set.size || set.has(t) || (t === 'integer' && set.has('number'));
      const producer = request ? at : bt, consumer = request ? bt : at;
      const unsafe = !producer.size ? !!consumer.size : [...producer].some(t => !accepts(consumer, t));
      add(unsafe ? 'breaking' : 'compatible', 'schema-type', location, `${direction} type changed`,
        [...at], [...bt], 'Update the client type and serialization; add a contract test for this field.');
    }
    if (!equal(a.enum, b.enum)) {
      const producer = request ? a.enum : b.enum, consumer = request ? b.enum : a.enum;
      const unsafe = Array.isArray(consumer) && (!Array.isArray(producer) || producer.some(v => !consumer.some(c => equal(v, c))));
      add(unsafe ? 'breaking' : 'compatible', 'schema-enum', location, `${direction} enum changed`, a.enum, b.enum,
        request ? 'Replace removed enum values in requests.' : 'Handle every new response enum value, including fallbacks.');
    }
    const propsA = a.properties ?? {}, propsB = b.properties ?? {};
    if (!object(propsA) || !object(propsB)) { review(location, 'Invalid properties object', propsA, propsB); return; }
    const reqA = new Set(a.required ?? []), reqB = new Set(b.required ?? []);
    const visible = s => !(request ? s?.readOnly : s?.writeOnly);
    for (const name of new Set([...Object.keys(propsA), ...Object.keys(propsB), ...reqA, ...reqB])) {
      const loc = `${location}/properties/${ptr(name)}`;
      let x = propsA[name], y = propsB[name];
      const p = unwrap(x, y, loc); if (!p) continue;
      [x, y] = p;
      if (!visible(x) && !visible(y)) continue;
      const ax = own(propsA, name) && visible(x), by = own(propsB, name) && visible(y);
      if (request && reqB.has(name) && (!reqA.has(name) || !ax) && visible(y))
        add('breaking', 'request-required', loc, `Request now requires “${name}”`, reqA.has(name), true,
          `Supply ${name} in every affected request.`);
      if (!request && reqA.has(name) && (!reqB.has(name) || !by) && visible(x))
        add('breaking', 'response-required', loc, `Response no longer guarantees “${name}”`, true, false,
          `Handle missing ${name} in the client and update its response type.`);
      if (ax && !by) add(request ? 'review' : 'breaking', 'property-removed', loc,
        `${direction} property “${name}” removed`, x, undefined,
        request ? 'Remove this request field or confirm the server still tolerates it.' : `Replace reads of ${name} and update response fixtures.`);
      else if (!ax && by) add('compatible', 'property-added', loc, `${direction} property “${name}” added`, undefined, y,
        'Consider using this field; confirm generated clients remain compatible.');
      else if (ax && by) schema(x, y, direction, loc, depth + 1, next);
    }
    if (a.items !== undefined || b.items !== undefined) schema(a.items, b.items, direction, `${location}/items`, depth + 1, next);
    const low = ['minimum', 'minLength', 'minItems', 'minProperties'];
    const high = ['maximum', 'maxLength', 'maxItems', 'maxProperties'];
    for (const key of [...low, ...high]) {
      if (equal(a[key], b[key])) continue;
      const fallback = low.includes(key) ? -Infinity : Infinity;
      const av = a[key] ?? fallback, bv = b[key] ?? fallback;
      const tighter = low.includes(key) ? bv > av : bv < av;
      add((request ? tighter : !tighter) ? 'breaking' : 'compatible', `constraint-${key}`, `${location}/${key}`,
        `${direction} ${key} changed`, a[key], b[key], 'Test boundary values and update client validation.');
    }
    if (!equal(a.additionalProperties, b.additionalProperties)) {
      if (typeof a.additionalProperties === 'object' || typeof b.additionalProperties === 'object') {
        schema(a.additionalProperties ?? {}, b.additionalProperties ?? {}, direction, `${location}/additionalProperties`, depth + 1, next);
      } else {
        const av = a.additionalProperties !== false, bv = b.additionalProperties !== false;
        add((request ? av && !bv : !av && bv) ? 'breaking' : 'compatible', 'additional-properties', location,
          `${direction} additional properties changed`, a.additionalProperties, b.additionalProperties,
          'Check unknown-field handling and generated client deserialization.');
      }
    }
    const handled = new Set(['type', 'nullable', 'enum', 'properties', 'required', 'items', 'additionalProperties', ...low, ...high]);
    const annotation = new Set(['title', 'description', 'example', 'examples', 'default', 'deprecated', 'externalDocs', '$id', '$schema']);
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (handled.has(key) || annotation.has(key) || key.startsWith('x-')) continue;
      if (!equal(a[key], b[key])) review(`${location}/${key}`, `Review ${direction} schema keyword “${key}”`, a[key], b[key]);
    }
    for (const key of ['allOf', 'oneOf', 'anyOf', 'not', 'if', 'then', 'else', 'patternProperties', 'unevaluatedProperties', '$dynamicRef']) {
      if (own(a, key) || own(b, key)) review(`${location}/${key}/coverage`, `Complex schema “${key}” needs manual compatibility review`, a[key], b[key]);
    }
  }
  function content(a, b, direction, location) {
    a ??= {}; b ??= {};
    for (const media of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const loc = `${location}/${ptr(media)}`;
      if (!own(b, media)) add('breaking', 'media-removed', loc, `${direction} media type removed: ${media}`, media, undefined,
        'Change the client Content-Type or Accept header and payload encoding.');
      else if (!own(a, media)) add('compatible', 'media-added', loc, `${direction} media type added: ${media}`, undefined, media,
        'Optional: adopt the new representation.');
      else schema(a[media].schema, b[media].schema, direction, `${loc}/schema`);
    }
  }
  const paths = new Set([...Object.keys(before.paths), ...Object.keys(after.paths)]);
  for (const path of paths) {
    context = {method: 'API', path, operationId: ''};
    const pairs = unwrap(before.paths[path], after.paths[path], `/paths/${ptr(path)}`);
    if (!pairs) continue;
    const [ap = {}, bp = {}] = pairs;
    for (const method of METHODS) {
      const a = ap[method], b = bp[method]; if (!a && !b) continue;
      context = {method: method.toUpperCase(), path, operationId: a?.operationId ?? b?.operationId ?? ''};
      if (!b) { add('breaking', 'operation-removed', '', 'Endpoint removed', a?.operationId, undefined,
        'Migrate callers to the replacement endpoint before upgrading.'); continue; }
      if (!a) { add('compatible', 'operation-added', '', 'Endpoint added', undefined, b.operationId,
        'Optional: adopt the new endpoint.'); continue; }
      if (a.operationId !== b.operationId) add('review', 'operation-id', '/operationId', 'SDK operation name changed', a.operationId, b.operationId,
        'Regenerate the SDK and update renamed method calls.');
      if (!a.deprecated && b.deprecated) add('review', 'operation-deprecated', '/deprecated', 'Endpoint is now deprecated', false, true,
        'Plan migration to the supported replacement.');
      const secA = a.security ?? before.security ?? [], secB = b.security ?? after.security ?? [];
      const secDefsA = (before.components ?? {}).securitySchemes ?? {}, secDefsB = (after.components ?? {}).securitySchemes ?? {};
      const names = new Set([...secA, ...secB].flatMap(s => Object.keys(s)));
      if (!equal(secA, secB) || [...names].some(n => !equal(secDefsA[n], secDefsB[n])))
        review('/security', 'Authentication or scopes changed', {requirements: secA, schemes: [...names].map(n => secDefsA[n])},
          {requirements: secB, schemes: [...names].map(n => secDefsB[n])});
      if (!equal(a.servers ?? ap.servers ?? before.servers, b.servers ?? bp.servers ?? after.servers))
        review('/servers', 'Server URL configuration changed', a.servers ?? ap.servers ?? before.servers, b.servers ?? bp.servers ?? after.servers);
      function params(spec, inherited = [], local = []) {
        const out = new Map();
        for (const p of [...inherited, ...local]) {
          const v = resolve(spec, p);
          if (!object(v) || typeof v.name !== 'string' || typeof v.in !== 'string') throw new Error('Invalid parameter');
          const key = `${v.in}:${v.in === 'header' ? v.name.toLowerCase() : v.name}`;
          out.set(key, v);
        }
        return out;
      }
      let pa, pb;
      try { pa = params(before, ap.parameters, a.parameters); pb = params(after, bp.parameters, b.parameters); }
      catch (error) { review('/parameters', error.message, a.parameters, b.parameters); pa = pb = new Map(); }
      for (const key of new Set([...pa.keys(), ...pb.keys()])) {
        const x = pa.get(key), y = pb.get(key), loc = `/parameters/${ptr(key)}`;
        if (!y) add('review', 'parameter-removed', loc, `Parameter removed: ${key}`, x, undefined, 'Remove this parameter or confirm backward tolerance.');
        else if (!x) add(y.required ? 'breaking' : 'compatible', 'parameter-added', loc, `Parameter added: ${key}`, undefined, y,
          y.required ? `Supply ${y.name} in every request.` : 'Optional: use this parameter.');
        else {
          if (!x.required && y.required) add('breaking', 'parameter-required', loc, `Parameter now required: ${key}`, false, true, `Supply ${y.name} in every request.`);
          schema(x.schema, y.schema, 'request', `${loc}/schema`);
          content(x.content, y.content, 'request', `${loc}/content`);
          for (const k of ['style', 'explode', 'allowReserved', 'allowEmptyValue'])
            if (!equal(x[k], y[k])) review(`${loc}/${k}`, `Parameter serialization changed: ${key}`, x[k], y[k]);
        }
      }
      const bodies = unwrap(a.requestBody, b.requestBody, '/requestBody');
      if (bodies) {
        const [x, y] = bodies;
        if (y?.required && !x?.required) add('breaking', 'body-required', '/requestBody', 'Request body now required', x?.required, true, 'Supply a request body on all calls.');
        if (x && !y) review('/requestBody', 'Request body removed', x, undefined);
        else content(x?.content, y?.content, 'request', '/requestBody/content');
      }
      for (const status of new Set([...Object.keys(a.responses ?? {}), ...Object.keys(b.responses ?? {})])) {
        const x = a.responses?.[status], y = b.responses?.[status], loc = `/responses/${status}`;
        if (!y) add('breaking', 'response-removed', loc, `Response ${status} removed`, status, undefined, 'Update status handling and success/error fixtures.');
        else if (!x) add('review', 'response-added', loc, `New possible response: ${status}`, undefined, status, 'Ensure the client handles this status code.');
        else {
          const resp = unwrap(x, y, loc); if (!resp) continue;
          content(resp[0]?.content, resp[1]?.content, 'response', `${loc}/content`);
          if (!equal(resp[0]?.headers, resp[1]?.headers)) review(`${loc}/headers`, 'Response headers changed', resp[0]?.headers, resp[1]?.headers);
        }
      }
      for (const key of ['callbacks', 'externalDocs']) if (!equal(a[key], b[key]) && key === 'callbacks')
        review(`/${key}`, 'Callback contract changed', a[key], b[key]);
    }
  }
  context = {method: 'API', path: '/', operationId: ''};
  if (before.openapi !== after.openapi) review('/openapi', 'OpenAPI version changed; dialect semantics may differ', before.openapi, after.openapi);
  if (!equal(before.webhooks, after.webhooks)) review('/webhooks', 'Webhook contract changed', before.webhooks, after.webhooks);
  if (truncated) review('/limits', 'Finding limit reached: analysis incomplete', MAX_FINDINGS, 'more');
  const severityOrder = {breaking: 0, review: 1, compatible: 2};
  findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || a.path.localeCompare(b.path) || a.id.localeCompare(b.id));
  return {formatVersion: 1, before: {title: before.info?.title ?? 'Before', version: before.info?.version ?? '?'},
    after: {title: after.info?.title ?? 'After', version: after.info?.version ?? '?'},
    counts: {breaking: findings.filter(f => f.severity === 'breaking').length, review: findings.filter(f => f.severity === 'review').length,
      compatible: findings.filter(f => f.severity === 'compatible').length}, incomplete: truncated, findings,
    coverage: 'Heuristic OpenAPI 3.0/3.1 comparison. JSON only; local refs. Complex schemas and unresolved refs require review. No finding is not proof of compatibility.'};
}

export function attachSources(report, sources) {
  if (sources.length > 1000) throw new Error('Limit is 1,000 source files.');
  let total = 0;
  const clean = sources.map(({name, text}) => {
    if (typeof name !== 'string' || typeof text !== 'string') throw new Error('Source files need name and text.');
    total += text.length; if (total > 10 * 1024 * 1024) throw new Error('Source text limit is 10 MiB.');
    return {name, lines: text.split('\n')};
  });
  return {...report, sourcesScanned: clean.length, findings: report.findings.map(f => {
    const tokens = [f.operationId, f.path].filter(v => v && v !== '/');
    const parts = f.path.split(/\{[^}]+\}/).filter(s => s.length >= 4);
    const hits = []; let capped = false;
    for (const file of clean) for (let i = 0; i < file.lines.length; i++) {
      const line = file.lines[i];
      const exact = tokens.find(t => line.includes(t));
      const partial = !exact && parts.some(t => line.includes(t));
      if (exact || partial) {
        if (hits.length >= 100) { capped = true; continue; }
        hits.push({file: file.name, line: i + 1, match: exact ? 'literal' : 'path-fragment', excerpt: line.trim().slice(0, 240)});
      }
    }
    return {...f, hits, hitsTruncated: capped};
  })};
}

export function markdown(report) {
  const safe = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('`', '\\`').replaceAll('\r', '').replaceAll('\n', ' ');
  return [`# Driftline migration plan`, '', `${safe(report.before.title)} ${safe(report.before.version)} → ${safe(report.after.version)}`, '',
    `${report.counts.breaking} breaking · ${report.counts.review} to review · ${report.counts.compatible} compatible`, '',
    report.coverage, '', 'Source references are textual candidates, not verified call graphs.', '',
    ...report.findings.flatMap(f => [`## ${f.severity.toUpperCase()}: ${safe(f.title)}`, '',
      `Operation: ${safe(f.method)} ${safe(f.path)}`, `Location: ${safe(f.location || '(operation)')}`, '',
      `Before: ${safe(f.before).slice(0, 2000)}`, `After: ${safe(f.after).slice(0, 2000)}`, '', safe(f.action), '',
      ...(f.hits ?? []).map(h => `- ${safe(h.file)}:${h.line} (${h.match}): ${safe(h.excerpt)}`), '',
      ...(f.hitsTruncated ? ['More references omitted (100 per finding limit).', ''] : [])])].join('\n');
}
