<!-- Briefly describe the problem this change solves. -->

Problems
--------

Changes
-------
-

Test Plan
---------

### Testing performed (check all that apply):
At least one selection is required. `untested` is only meant for code that is impossible to test before deploying.
- [ ] **rspec** - Automated tests added/updated and passing
- [ ] **local** - Manual testing performed locally
- [ ] **sandbox** - Testing performed in sandbox environment
- [ ] **platform** - Platform/infrastructure changes validated by CI
- [ ] **untested** - No testing performed (explain why below)

### Test details:
<!-- If rspec: list the test file names and key test cases.
     If local: describe the manual testing steps and outcomes.
     If sandbox: describe the sandbox testing performed.
     If platform: describe the CI/platform validation performed.
     If untested: explain why testing was not possible. -->

Coding Quality Discipline
-------------------------
- [ ] I have reviewed and confirmed that this code adheres to the company's [design and coding principles and guidelines](https://limebike.atlassian.net/wiki/x/TgBLAQE).
- [ ] Any trade-off or deviation from the principles and guidelines has been documented and flagged for review.

Primary Database Load
---------------------
- [ ] **No unnecessary primary reads**: New queries in write-heavy request flows target tables in `ALWAYS_REPLICA_TABLES`, or I have confirmed primary reads are required (read-after-write consistency, transactions, payment-critical data).
- [ ] **New high-volume read tables considered**: If this PR adds queries to tables currently sending 100%+ of queries to primary (check the [PlanetScale Tier 1 dashboard](https://app.datadoghq.com/dashboard/j2f-mnt-wv7/planetscale-tier-1-dashboard)), I have evaluated whether the table is a safe candidate for `ALWAYS_REPLICA_TABLES`.

Additional docs
---------------
Link to Jira ticket:

Link to RFC:

Link to PRD:

- [ ] I have read and understood the company's [PR guidelines](https://limebike.atlassian.net/wiki/spaces/DOC/pages/2735996932/PR+Guidelines).
- [ ] This change does **not** break inter-service contracts (API, Pub/Sub, message formats) between canary and production. If it does, describe the impact, rollout/mitigation plan, and link to [Incident#1002](https://app.datadoghq.com/notebook/12237378/postmortem-ir-1002-global-25-drop-in-unlock-success?view=view-mode) as cautionary example.
