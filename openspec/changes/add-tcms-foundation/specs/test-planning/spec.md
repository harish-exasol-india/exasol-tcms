## Purpose

The reusable structures that test runs are created from and reported against: named test
plans, execution environments and configurations, and the releases that release-readiness
reporting is organised around.

## ADDED Requirements

### Requirement: Reusable test plans
The system SHALL support named, reusable selections of test cases from which runs are
instantiated, so that a recurring selection need not be rebuilt each cycle.

#### Scenario: Creating a run from a plan
- **WHEN** a user creates a run from an existing test plan
- **THEN** the run contains exactly the cases the plan selects at the time the run is created

#### Scenario: Editing a plan does not alter existing runs
- **WHEN** a test plan is edited after runs have been created from it
- **THEN** the case membership of those existing runs is unchanged

### Requirement: Environments and configurations
The system SHALL support named environments and configurations against which a run
executes, and SHALL record the environment on every run.

#### Scenario: Same plan run against two environments
- **WHEN** the same test plan is run against two different environments
- **THEN** the two runs are tracked separately and their results are attributable to their respective environments

#### Scenario: Environment recorded from CI
- **WHEN** an automated result upload supplies an environment name
- **THEN** the auto-created run records that environment

### Requirement: Releases
The system SHALL support named releases to which runs are attributed, and every run
SHALL be attributable to at most one release.

#### Scenario: Attributing a run to a release
- **WHEN** a run is created with a release specified
- **THEN** the run appears in that release's readiness view

#### Scenario: Run without a release
- **WHEN** a run is created without a release
- **THEN** the run is accepted and is excluded from release readiness views
