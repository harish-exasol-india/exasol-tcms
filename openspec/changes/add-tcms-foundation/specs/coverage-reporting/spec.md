## Purpose

Visibility into which managed test cases are covered by automation and which remain
manual or never executed, sliced by the dimensions teams actually plan against.

## ADDED Requirements

### Requirement: Automation coverage of managed cases
The system SHALL report, for any selection of managed test cases, how many are covered by
an automation binding, how many remain manual, and how many have never been executed.

#### Scenario: Coverage summary for a project
- **WHEN** a user opens the coverage view for a project
- **THEN** the system reports counts of automated, manual, and never-executed cases, together summing to the total managed cases in that project

#### Scenario: Identifying uncovered cases
- **WHEN** a user drills into the manual portion of a coverage summary
- **THEN** the system lists the individual cases that have no automation binding

### Requirement: Coverage filtering
Coverage SHALL be filterable by suite, tag, custom field value, and release.

#### Scenario: Filtering coverage by suite and tag
- **WHEN** a user filters coverage to one suite subtree and one tag
- **THEN** the reported counts reflect only cases matching both criteria

#### Scenario: Filtering coverage by release
- **WHEN** a user filters coverage to a release
- **THEN** the reported counts reflect only cases executed in runs attributed to that release

### Requirement: Coverage by testing category
Because testing category is expressed as a tag, coverage SHALL be reportable grouped by
tag so that integration, end-to-end, performance, and security categories can be assessed
separately.

#### Scenario: Coverage grouped by category tag
- **WHEN** a user groups the coverage view by tag
- **THEN** each tag is reported with its own automated, manual, and never-executed counts

#### Scenario: Cases carrying no category tag
- **WHEN** cases exist that carry no category tag
- **THEN** they are reported in an explicit untagged group rather than omitted
