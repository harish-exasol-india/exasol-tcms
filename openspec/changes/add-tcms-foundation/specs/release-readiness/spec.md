## Purpose

A single release-level view bringing together execution progress, blocking failures,
linked defects, coverage gaps, UAT status, and sign-off, sufficient to support a confident
go/no-go discussion.

## ADDED Requirements

### Requirement: Release execution progress
The system SHALL show, for a release, the aggregate execution progress across all runs
attributed to it.

#### Scenario: Progress across multiple runs
- **WHEN** a user opens the readiness view for a release with several runs
- **THEN** the system reports total cases executed, passed, failed, blocked, skipped, and not yet executed across those runs

#### Scenario: Release with no runs
- **WHEN** a user opens the readiness view for a release that has no runs
- **THEN** the system reports that no execution data exists rather than reporting zero failures as a passing state

### Requirement: Blocking failures visible
The system SHALL identify, for a release, the failures that are untriaged or triaged as
requiring action, distinguished from those triaged as known or flaky.

#### Scenario: Untriaged failures highlighted
- **WHEN** a release contains failures in the new state
- **THEN** they are reported as blocking and are individually listable

#### Scenario: Known issues excluded from blocking
- **WHEN** a release contains failures triaged as known issue
- **THEN** they are reported separately and are not counted as blocking

### Requirement: Linked defects visible
The system SHALL list the Jira issues linked to failures within a release, each rendered
as a link to Jira.

#### Scenario: Defect list for a release
- **WHEN** a user opens the readiness view for a release with linked defects
- **THEN** the linked issue references are listed with links to Jira and to the failures they were raised from

### Requirement: Coverage gaps and UAT status in the same view
The release readiness view SHALL display the release's coverage summary and the status of
runs designated as UAT alongside execution progress.

#### Scenario: Coverage gap shown with progress
- **WHEN** a user opens the readiness view
- **THEN** the coverage summary for the release is displayed without navigating away

#### Scenario: UAT run status shown
- **WHEN** a release has runs designated as UAT
- **THEN** their completion status is displayed distinctly from other runs

### Requirement: Manual sign-off gate
The system SHALL support a per-release checklist of named sign-off items that designated
approvers mark complete, and SHALL display the resulting gate status in the readiness
view.

#### Scenario: Approver signs off
- **WHEN** a designated approver marks a sign-off item complete
- **THEN** the item records the approver's identity and timestamp, and the gate status updates

#### Scenario: Gate incomplete
- **WHEN** any sign-off item on a release remains incomplete
- **THEN** the gate status is reported as not signed off, listing the outstanding items and their assigned approvers

#### Scenario: Sign-off restricted to approvers
- **WHEN** a user who is not a designated approver attempts to mark a sign-off item complete
- **THEN** the action is rejected and the item is unchanged

#### Scenario: Evidence shown alongside the gate
- **WHEN** a user views the gate status
- **THEN** the release's pass rate, blocking failure count, and coverage summary are displayed alongside it, so that approval is made against visible evidence
