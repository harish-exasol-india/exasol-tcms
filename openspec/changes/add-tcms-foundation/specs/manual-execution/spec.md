## Purpose

Structured manual test execution for UAT, release validation, and scenario-based
testing, efficient enough for repeated release cycles and for participation by business
users who are not full-time testers.

## ADDED Requirements

### Requirement: Structured manual runs
The system SHALL support manual runs in which a tester works through the cases in a run
and records a result for each.

#### Scenario: Recording a case result
- **WHEN** a tester records a result of passed, failed, blocked, or skipped for a case in a run
- **THEN** the result is persisted against that run and the run's progress reflects it

#### Scenario: Resuming an in-progress run
- **WHEN** a tester returns to a run they partially executed earlier
- **THEN** previously recorded results are shown and execution resumes from the first case without a result

### Requirement: Step-level results
The system SHALL allow a tester to record an outcome against each individual step of a
case, and a case-level result SHALL be derivable from its step outcomes.

#### Scenario: Failing a single step
- **WHEN** a tester marks step 3 of a five-step case as failed
- **THEN** the case result is failed and the failing step is identified

### Requirement: Evidence attachments
Testers SHALL be able to attach files such as screenshots, logs, and documents to a step
or to a run, and those attachments SHALL be retrievable for as long as the run is
retained.

#### Scenario: Attaching evidence to a failed step
- **WHEN** a tester attaches a screenshot to a failed step
- **THEN** the attachment is stored and is retrievable from that step's result

#### Scenario: Attachment exceeds the size limit
- **WHEN** a tester uploads a file larger than the configured maximum
- **THEN** the upload is rejected with a message stating the limit, and no partial attachment is retained

### Requirement: Concurrent execution safety
The system SHALL prevent one tester's result from silently overwriting another's when
two testers work the same run, and SHALL keep run progress approximately current for all
viewers.

#### Scenario: Conflicting result writes
- **WHEN** two testers record different results for the same case in the same run and the second write is based on a stale version
- **THEN** the second write is rejected, and the tester is shown the other result before being asked to confirm

#### Scenario: Progress visible to concurrent testers
- **WHEN** one tester records results while another has the run open
- **THEN** the second tester's view of run progress updates without a manual page reload

### Requirement: Defect links to Jira
A tester SHALL be able to record a Jira issue reference against a failed step or case,
and the system SHALL render it as a link to that issue.

#### Scenario: Linking a defect to a failed step
- **WHEN** a tester records a Jira issue key against a failed step
- **THEN** the step displays a link that opens that issue in Jira

#### Scenario: Invalid issue reference
- **WHEN** a tester enters a value that does not match the configured Jira issue key format
- **THEN** the system rejects it and states the expected format
