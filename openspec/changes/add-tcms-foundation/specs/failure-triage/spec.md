## Purpose

The workflow that turns a stream of automated failures into a manageable set of decisions,
by carrying a human's judgement about a failure forward automatically to matching failures
in later imports.

## ADDED Requirements

### Requirement: Triage states for failures
Every failed result SHALL carry a triage state drawn from a defined set covering at least
new, investigating, known issue, flaky, and resolved.

#### Scenario: New failure defaults to new
- **WHEN** a failure is ingested that matches no prior triaged failure
- **THEN** its triage state is new

#### Scenario: Changing a triage state
- **WHEN** a user sets a failure's triage state to known issue
- **THEN** the state is persisted with the acting user and timestamp

### Requirement: Failure signature
The system SHALL derive a signature for each failure from the bound test case and the
normalised failure output, and SHALL use it to recognise recurrences of the same failure.

#### Scenario: Same failure recognised across runs
- **WHEN** the same test fails with equivalent failure output in two separate runs
- **THEN** both failures resolve to the same signature

#### Scenario: Different failure not conflated
- **WHEN** the same test fails with materially different failure output
- **THEN** the two failures resolve to different signatures and are triaged independently

### Requirement: Automatic triage carry-forward
When an ingested failure matches the signature of a previously triaged failure, the
system SHALL apply that prior triage state automatically without human intervention.

#### Scenario: Known issue does not re-alert
- **WHEN** a failure matching a signature previously marked known issue is ingested
- **THEN** the new failure is marked known issue automatically and is excluded from the new-failure count

#### Scenario: New failures remain distinguishable
- **WHEN** a run contains both recurrences of triaged failures and failures matching no prior signature
- **THEN** the run summary reports the two counts separately

#### Scenario: Resolved failure recurring
- **WHEN** a failure matching a signature previously marked resolved is ingested
- **THEN** it is reported as a regression rather than silently inheriting the resolved state
