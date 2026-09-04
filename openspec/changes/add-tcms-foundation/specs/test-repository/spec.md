## Purpose

The single managed repository for every test asset at Exasol, holding manual and
automated test cases together with the metadata, structure, and change history needed to
own them over a product's lifetime.

## ADDED Requirements

### Requirement: Unified repository for manual and automated cases
The system SHALL store manual and automated test cases in one repository, distinguished
by an automation status attribute rather than by living in separate stores.

#### Scenario: Manual and automated cases coexist in a suite
- **WHEN** a user views a suite containing both manual and automated cases
- **THEN** all cases are listed together, each showing its automation status

#### Scenario: Automation status changes without moving the case
- **WHEN** an automated test becomes bound to a previously manual case
- **THEN** the case's automation status updates in place and its identifier is unchanged

### Requirement: Test case metadata
Each test case SHALL carry an owner, priority, risk, tags, preconditions, ordered steps
with expected results, and an automation status.

#### Scenario: Creating a case with full metadata
- **WHEN** a user creates a test case supplying owner, priority, risk, preconditions, and at least one step with an expected result
- **THEN** the case is persisted with all supplied metadata and is retrievable by its identifier

#### Scenario: Rejecting a case with no steps
- **WHEN** a user attempts to save a test case with zero steps
- **THEN** the system rejects the save and reports that at least one step is required

### Requirement: Suite tree organisation
The system SHALL organise cases in a nested suite tree representing product, component,
and module, where each case belongs to exactly one suite.

#### Scenario: Browsing a nested suite
- **WHEN** a user opens a suite that has child suites
- **THEN** the system displays the child suites and the cases belonging directly to that suite

#### Scenario: Moving a case between suites
- **WHEN** a user moves a case to a different suite
- **THEN** the case's identifier, history, and automation bindings are preserved

### Requirement: Tag normalisation
The system SHALL normalise tags on write by lowercasing, trimming surrounding
whitespace, and collapsing internal whitespace, and SHALL offer existing tags as
suggestions during entry.

#### Scenario: Equivalent tags converge
- **WHEN** a user enters the tag "  End-To-End  " on a case where the tag "end-to-end" already exists
- **THEN** the case is tagged "end-to-end" and no second tag is created

#### Scenario: Suggestions offered during entry
- **WHEN** a user begins typing a tag name
- **THEN** the system offers matching existing tags before a new tag is created

### Requirement: Shared steps
The system SHALL support named step blocks that are defined once and referenced by many
cases, and SHALL render a referenced block's current content wherever it appears.

#### Scenario: Referencing a shared step
- **WHEN** a user inserts a shared step into a case
- **THEN** the case renders the shared step's current content in position among its own steps

#### Scenario: Editing a shared step propagates
- **WHEN** a shared step is edited
- **THEN** every case referencing it renders the updated content

#### Scenario: Impact is visible before editing
- **WHEN** a user opens a shared step for editing
- **THEN** the system displays how many cases and how many open runs reference it

### Requirement: Custom fields
Administrators SHALL be able to define additional typed fields on test cases beyond the
built-in metadata, and those fields SHALL be available for filtering.

#### Scenario: Defining and populating a custom field
- **WHEN** an administrator defines a custom field and a user sets its value on a case
- **THEN** the value is stored with the case and the case is retrievable by filtering on that value

#### Scenario: Removing a custom field definition
- **WHEN** an administrator removes a custom field definition that has values on existing cases
- **THEN** the system warns how many cases are affected before the removal proceeds

### Requirement: Change history
The system SHALL retain a history entry for every change to a test case, recording what
changed, who changed it, when, and through which interface.

#### Scenario: Viewing case history
- **WHEN** a user opens the history of a test case that has been edited three times
- **THEN** the system lists three entries, each identifying the actor, timestamp, and changed fields

#### Scenario: History survives suite moves and renames
- **WHEN** a case is renamed and moved to another suite
- **THEN** its earlier history entries remain visible on the case
