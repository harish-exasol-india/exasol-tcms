## Purpose

Headless ingestion of automated test results from CI into the managed repository, and the
binding of automated tests to managed test cases via identifiers stable enough for
coverage reporting to be trusted.

## ADDED Requirements

### Requirement: Headless result upload
The system SHALL accept automated test results over HTTP without any interactive step,
so that a GitHub Actions job can upload results using only a scoped API token.

#### Scenario: Uploading results from a CI job
- **WHEN** a CI job posts a JUnit XML document with a valid scoped API token
- **THEN** the results are ingested and the response identifies the run that was created

#### Scenario: Upload without a valid token
- **WHEN** a result upload is attempted without a valid token or with a token lacking access to the target project
- **THEN** the upload is rejected and no results are ingested

### Requirement: JUnit XML format support
The system SHALL accept JUnit XML, the format emitted by both Pytest and Playwright, and
SHALL report parse failures without partially ingesting a document.

#### Scenario: Ingesting a Pytest JUnit report
- **WHEN** a JUnit XML document produced by Pytest is uploaded
- **THEN** each test case element becomes a result with its outcome, duration, and failure message

#### Scenario: Malformed document rejected atomically
- **WHEN** an uploaded document is not well-formed JUnit XML
- **THEN** the upload is rejected with a parse error and no results from that document are persisted

### Requirement: Run auto-creation without approval
The system SHALL create the run for an upload automatically, with no manual approval or
reconciliation step in normal operation.

#### Scenario: Run created on upload
- **WHEN** results are uploaded with release, environment, commit SHA, and branch supplied
- **THEN** a run is created recording those values and the results are attached to it, requiring no further human action

#### Scenario: Results visible immediately
- **WHEN** an upload completes successfully
- **THEN** the results are reflected in coverage and release views without an intervening approval

### Requirement: Automation binding by stable identifier
The system SHALL bind an incoming automated test to a managed test case, preferring an
explicit case identifier declared by the test and falling back to the test's
fully-qualified name.

#### Scenario: Binding by explicit case identifier
- **WHEN** an incoming test declares a managed case identifier
- **THEN** the result binds to that case regardless of the test's name or file path

#### Scenario: Binding by fully-qualified name
- **WHEN** an incoming test declares no case identifier but its fully-qualified name matches an existing binding
- **THEN** the result binds to the case that binding points to

#### Scenario: Unbound test result
- **WHEN** an incoming test matches no case by either method
- **THEN** the result is retained and reported as unbound, and no test case is created automatically

### Requirement: Binding confidence and staleness are visible
The system SHALL record how each binding was established and when it was last matched,
and SHALL surface bindings that are name-based or that have not been seen recently.

#### Scenario: Name-based bindings reported as fragile
- **WHEN** a user views the automation binding report
- **THEN** bindings established by name match are distinguished from those established by explicit identifier

#### Scenario: Stale binding surfaced
- **WHEN** a binding has not been matched by any upload within the configured staleness threshold
- **THEN** it is reported as stale, identifying the case and the last time it was seen

#### Scenario: Promoting a binding
- **WHEN** a test that previously bound by name begins declaring an explicit case identifier
- **THEN** the binding is recorded as identifier-based from that upload onward, and its history is retained
