# [RFC] <Title>

Author: <Your Name>  
Last Updated: <Date>  
Main Team: <Team>  
Scope: <Scope>

## Reviewers

| Reviewer | Reviewer Team | Status | Review Date | Notes |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |
|  |  |  |  |  |
|  |  |  |  |  |
|  |  |  |  |  |

## Tags

- Database: <Database or N/A>
- Required Reviewer Teams: <Teams that must sign off, with a reviewer for each>

## Context

<Brief, specific background on the problem to solve. Define uncommon acronyms.>

## Business Goals

- <Goal 1>

### Non-Goals / Out of Scope

- <Non-goal 1>

### Related Product Documents

| Document | Link |
| --- | --- |
| PRD | <Link to PRD> |
| Figma | <Link to Figma> |

## Design

<Describe the solution in enough detail to support implementation and review.>

### Technical Objectives

#### Functional Requirements

<Key design questions, problem statements, and P0/P1/P2 requirements.>

#### Non-Functional Requirements

<Targets that define success beyond correctness.>

- Availability: <Target>
- Latency: <p50, p95, p99 target for critical paths>
- Scalability: <Expected growth and limits>
- Observability: <Metrics, alerts, and logs>

### Proposed Solution

<Describe the proposed design. Include diagrams, flows, API endpoints, data
models, failure scenarios, and impacts as needed.>

#### API Integration Contracts

<Include this subsection whenever the proposal adds, changes, or depends on
an API. For every endpoint, document all applicable items below. If no API
contract is relevant, state why.>

##### `<METHOD> <PATH>`

**Purpose and logic**

<Describe when the endpoint is called, its authorization and business logic,
side effects, idempotency and retry behavior, and the caller behavior for each
outcome.>

**Request**

<Document path parameters, query parameters, headers, authentication, and
request body. Define field names, types, required or optional status, allowed
values, defaults, and validation rules. Include a representative request
example when applicable.>

```http
<METHOD> <PATH>
Content-Type: application/json

{ ... }
```

**Responses**

<Define every possible response format, including each success variant and
each error variant. For every variant, include the status code, conditions,
response schema, field semantics, and caller behavior. Include a representative
response example when applicable.>

| Status | When returned | Format and caller behavior |
| --- | --- | --- |
| `2xx` | <Condition> | <Schema and behavior> |
| `4xx` | <Condition> | <Error schema and behavior> |
| `5xx` | <Condition> | <Error schema and behavior> |

```json
{ ... }
```

### Alternative Options Considered

<For complex designs, compare alternatives with their pros and cons, then
explain why the proposed solution is preferred.>

## Rollout Plan

<High-level rollout plan or experiment design.>

### Implementation Plan

<Break the approved design into implementation-ready work for the selected
repository scopes. Cover all applicable modules, such as data migrations,
feature flags and configuration, APIs, clients, background jobs, testing,
observability, and rollout tooling. Each task must describe a concrete change,
its dependencies or sequencing, and its acceptance criteria. Use `TBD` for an
unknown estimate or dependency; do not invent either.>

| Module | Task | Implementation details and acceptance criteria | Dependencies / sequence | Estimated effort (eng days) |
| --- | --- | --- | --- | --- |
| <Module> | <Concrete change> | <Implementation details and acceptance criteria> | <Dependencies or sequence> | <Estimate or TBD> |

<Add rows until the plan covers every design change. Include a total estimate
only when every applicable task has a supported estimate.>

### Experiment Exposure

<Where the experiment assignment takes place and whether mobile changes are
required.>

## Operational Metrics, Monitors and Alerts

<Metrics and monitors needed to observe the solution.>

## Success Metrics

<Success metrics and counter metrics.>

## Follow-up Work

<Post-launch iterations, technical debt, and plans to address them.>

## Key Considerations

<Customize this section. Omit subsections that are not relevant.>

### Backward Compatibility

<Explain API and asynchronous communication compatibility. Describe the
rollout and mitigations for any incompatible changes.>

- Could this break an API contract?
- Could this break asynchronous communication?

### Downstream Data Impact

<List production data tables affected by the launch, including schema and
field-value changes. Add DSA and DE reviewers for data-model changes.>

| Table Name | Schema Change(s) | Value/Field Change(s) |
| --- | --- | --- |
|  |  |  |

### Downstream Revenue Reporting Impact

<Explain whether downstream revenue reporting is affected. Include Data and
FP&A reviewers when applicable.>

### Infrastructure & Load Considerations

<Describe infrastructure, query, RPS/job volume, dependency, cost, retry,
timeout, circuit-breaker, caching, and fallback implications. Consult platform
engineering when the details are uncertain.>

### Security and Privacy Considerations

#### Security

<Describe access controls, third-party tools or integrations, configuration
changes, and data flows. Add security reviewers when applicable.>

#### Privacy

<Describe effects on vehicle behavior, data collection, or data sharing. Add
privacy reviewers when applicable.>

## Appendix

<Supporting documents, diagrams, and related RFCs.>

## Review Notes

<Review discussion, decisions, and action items.>
