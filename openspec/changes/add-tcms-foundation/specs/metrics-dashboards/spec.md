## Purpose

The recurring operational view of quality: pass and failure rates, runtime, coverage,
flakiness, and open defect links, with trends over the retained history window.

## ADDED Requirements

### Requirement: Core quality metrics
The system SHALL report pass rate, failure rate, execution runtime, and coverage for a
selected project, release, or time period.

#### Scenario: Metrics for a release
- **WHEN** a user opens the metrics view scoped to a release
- **THEN** pass rate, failure rate, aggregate runtime, and coverage are reported for that release

#### Scenario: Metrics scoped to a time period
- **WHEN** a user selects a time period within the retained history window
- **THEN** the reported metrics reflect only runs within that period

### Requirement: Flakiness detection across runs
The system SHALL identify tests that produce differing outcomes across runs of the same
commit, and report them as flaky candidates.

#### Scenario: Alternating outcomes detected
- **WHEN** a test passes in one run and fails in another run of the same commit
- **THEN** the test is reported as a flaky candidate with the count of differing outcomes

#### Scenario: Consistently failing test not reported as flaky
- **WHEN** a test fails in every run of a commit
- **THEN** it is reported as failing and is not reported as a flaky candidate

### Requirement: Open defect links by age
The system SHALL report the Jira issues linked to failures, grouped by how long ago the
link was created.

#### Scenario: Defect links grouped by age
- **WHEN** a user opens the defect view
- **THEN** linked issues are grouped into age bands based on when the link was recorded in the system

### Requirement: Trend views
The system SHALL provide trend views over time for pass rate, failure rate, and runtime,
bounded by the retained history window.

#### Scenario: Pass rate trend
- **WHEN** a user opens the pass rate trend for a project
- **THEN** a series is displayed over the available retained period

#### Scenario: Trend request beyond retention
- **WHEN** a user requests a trend period extending earlier than the retention window
- **THEN** the system displays the available data and states that earlier data is outside the retention window
