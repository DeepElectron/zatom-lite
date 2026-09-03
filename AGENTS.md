# Engineering principles

These rules apply to all work in this repository unless the user explicitly overrides them.

## Implementation

- Build the smallest end-to-end implementation that satisfies the current requirement. Get the real path running before adding breadth.
- Choose that minimum implementation as a durable part of the intended architecture. Do not add knowingly temporary designs justified by “replacing them later.”
- Extend working code incrementally. Do not dismantle a functioning path merely to prepare for hypothetical future complexity.
- Prefer the simplest direct design. Do not add speculative abstractions, generic frameworks, configuration layers, indirection, or extension points without a present requirement.
- Keep responsibilities separated: each module should own one cohesive concern, expose a narrow contract, and remain loosely coupled to other modules.

## Existing code and dependencies

- Inspect the current implementation and dependency graph before designing a solution.
- Use an existing dependency when it already solves the problem well.
- Otherwise prefer a mature, actively maintained library with a proven design over custom infrastructure. Add a dependency only when its concrete value exceeds its integration and supply-chain cost.
- Do not reimplement established algorithms or product patterns without a clear project-specific reason.
- Before inventing a workflow or interface, study mature products and primary documentation that have already validated the relevant pattern; adapt the useful pattern to this codebase instead of copying incidental complexity.

## Compatibility and cleanup

- Backward compatibility is not a default requirement. Remove obsolete APIs, code paths, tests, and documentation directly.
- Do not add compatibility aliases, migration layers, deprecation shims, dual schemas, legacy fallbacks, or silent fallback behavior unless the user explicitly requires them.
- Keep exactly one canonical path for the current design. A replacement is complete only after the superseded path is deleted.

## Tests and verification

- Write a test only when it protects a necessary property: the main end-to-end path, a public contract, a scientific or numeric invariant, a security/safety boundary, or a reproduced regression.
- Prefer a small number of high-value behavioral tests over exhaustive permutations or implementation-detail tests.
- Do not retain redundant tests whose behavior is already covered at a stronger boundary.
- Match verification effort to risk. A minimal implementation still needs enough evidence to prove its claimed behavior, but test volume is not a quality goal.

## Decision order

When several implementations are viable, decide in this order:

1. Satisfies the current end-to-end requirement.
2. Can remain in the long-term architecture without a planned rewrite.
3. Reuses suitable existing code or dependencies.
4. Has the fewest concepts, layers, and configuration surfaces.
5. Preserves clear module boundaries and is easy to verify with a small set of meaningful tests.
