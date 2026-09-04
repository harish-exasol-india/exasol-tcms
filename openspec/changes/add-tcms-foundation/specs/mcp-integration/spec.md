## Purpose

An MCP interface exposing test cases, executions, coverage, and defect-related data so
that AI agents can both query and contribute to the TCMS, bounded by exactly the same
permission model as the web interface.

## ADDED Requirements

### Requirement: Read access to test assets and executions
The MCP interface SHALL expose test cases, suites, runs, results, coverage summaries, and
defect links for querying.

#### Scenario: Querying a case
- **WHEN** a client requests a test case by identifier
- **THEN** the case metadata, steps, tags, and automation status are returned

#### Scenario: Querying coverage
- **WHEN** a client requests a coverage summary for a project
- **THEN** the same counts are returned as the web coverage view reports for that project

#### Scenario: Querying failure history
- **WHEN** a client requests the failure history for a test case
- **THEN** the failures, their triage states, and the runs they occurred in are returned

### Requirement: Write access to test assets and executions
The MCP interface SHALL allow creating and updating test cases, creating runs, recording
results, and recording defect links.

#### Scenario: Creating a case through MCP
- **WHEN** a client with a role permitting case creation creates a case
- **THEN** the case is created and is indistinguishable in structure from one created through the web interface

#### Scenario: Recording a result through MCP
- **WHEN** a client with a role permitting execution records a result against a run
- **THEN** the result is persisted and is reflected in coverage and release views

### Requirement: MCP enforces the caller's per-project role
Every MCP operation SHALL resolve the caller's identity and per-project role and apply the
same permission rules as the web interface, with no alternative or elevated path.

#### Scenario: Write refused outside the caller's role
- **WHEN** a client whose role in a project is viewer attempts to create a case in that project
- **THEN** the operation is rejected

#### Scenario: Read refused for a non-member project
- **WHEN** a client requests data from a project in which the caller holds no role
- **THEN** the operation is rejected and no data is returned

#### Scenario: Permission rules not duplicated
- **WHEN** a per-project permission rule changes
- **THEN** the change takes effect for MCP and the web interface simultaneously, without a separate update

### Requirement: Agent-originated writes are attributable
Writes made through MCP SHALL be recorded with the MCP interface as their provenance, so
that agent-authored content is distinguishable from human-authored content.

#### Scenario: Distinguishing agent-authored cases
- **WHEN** a user filters test cases by originating interface
- **THEN** cases created through MCP are identifiable as such, together with the user whose token was used

### Requirement: Documented integration surface
The system SHALL publish documentation of the MCP tools and the REST API, covering
operations, parameters, and authentication.

#### Scenario: Documentation available
- **WHEN** an integrator consults the published documentation
- **THEN** every MCP tool and REST endpoint is described with its parameters, return shape, and required role
