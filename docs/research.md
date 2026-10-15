# Research and product hypothesis — 2026-10-15 UTC

Sources read after the user's 00:42 UTC usage reset:

- [Y Combinator, Requests for Startups, Fall 2026](https://www.ycombinator.com/rfs), specifically **Self-Maintaining APIs**. YC asks for tools connecting API provider changes to customer codebases and migrations. It also lists small-software hosting and multiplayer AI as areas of interest. This is investor-stated interest, not evidence customers will buy this particular prototype.
- [Sequoia, Own Your Intelligence: A How-To Guide, August 19, 2026](https://sequoiacap.com/article/own-your-intelligence-a-how-to-guide). Emphasizes evaluation, harnesses and feedback loops for useful AI workflows.
- [a16z, Investing in Keycard, October 21, 2025](https://a16z.com/announcement/investing-in-keycard/). Shows actual investment interest in scoped agent permissions. Considered this adjacent infrastructure direction; chose API migration instead because its correctness can be inspected with contract fixtures and useful without credentials or model spend.
- [OpenAPI 3.0.4 specification](https://spec.openapis.org/oas/v3.0.4.html), reference for contract semantics. Support is a documented subset of 3.0/3.1, not full conformance.

Inference: API changes offer a concrete entry point into YC's self-maintaining-API request. Start by proving which contract changes matter and where callers may be affected, before asking anyone to trust automatic edits. Driftline is the first stage: local contract diff, candidate source references, migration plan and CI gate.

Initial users to validate with: small API vendors releasing breaking versions and integration teams maintaining SDKs. Ask for recent migration incidents, time spent finding affected callers, false-positive tolerance and existing oasdiff/Optic/SDK tooling. Existing contract diff tools make raw diffing a crowded category; the hypothesis to test is whether a concise source-linked migration workflow is useful enough to switch to or pay for.

No revenue, customer traction, fundraising, investor endorsement or competitive moat is claimed. Next validation: test on consented real vendor/client pairs, measure missed breaks and noisy findings, interview maintainers, then consider code-aware migration PRs with tests. This prototype does not generate those PRs.
