## Purpose

How long execution history is kept and how test results leave the system for downstream
reporting.

## ADDED Requirements

### Requirement: Defined retention window
The system SHALL retain execution history for a defined and configurable window of twelve
months, after which execution records are deleted.

#### Scenario: Execution data older than the window is removed
- **WHEN** retention processing runs
- **THEN** runs and results whose execution date is older than the retention window are deleted

#### Scenario: Managed test assets are not deleted by retention
- **WHEN** retention processing removes execution history
- **THEN** test cases, suites, shared steps, plans, and their change history are unaffected

#### Scenario: Retention window is discoverable
- **WHEN** a user views execution history or a trend
- **THEN** the retention window in force is stated

### Requirement: Attachments follow their run
Attachments SHALL be removed when the run they belong to is removed by retention, so that
stored files do not outlive the records referencing them.

#### Scenario: Attachment removed with its run
- **WHEN** a run is deleted by retention processing
- **THEN** its attachments are deleted from object storage

#### Scenario: No orphaned attachments
- **WHEN** retention processing completes
- **THEN** no attachment remains in object storage without a run referencing it

### Requirement: Export from any filtered view
Users SHALL be able to export the contents of a filtered case, run, or result view as CSV
or JSON.

#### Scenario: Exporting a filtered result view
- **WHEN** a user applies filters to a result view and exports it
- **THEN** the exported file contains exactly the rows the filters select

#### Scenario: Export respects permissions
- **WHEN** a user exports a view
- **THEN** the export contains only data from projects in which that user holds a role

### Requirement: Programmatic result access
The system SHALL expose results through a paginated REST endpoint, filterable by project,
release, environment, and time period, authenticated with the same credentials as the
rest of the API.

#### Scenario: Paging through results
- **WHEN** a client requests results and more exist than fit in one page
- **THEN** the response indicates how to retrieve the next page, and paging through returns every matching result exactly once

#### Scenario: Filtering results by release
- **WHEN** a client requests results filtered to a release
- **THEN** only results from runs attributed to that release are returned
