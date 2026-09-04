## Purpose

Authentication for humans and machines, and a per-project role model practical for
engineers, QA leads, and occasional business users participating in UAT.

## ADDED Requirements

### Requirement: Local account authentication
The system SHALL authenticate users with locally held credentials and issue a session on
success.

#### Scenario: Successful sign-in
- **WHEN** a user submits valid credentials
- **THEN** a session is established and the user is admitted

#### Scenario: Failed sign-in
- **WHEN** a user submits invalid credentials
- **THEN** the attempt is rejected without disclosing whether the account exists

#### Scenario: Credentials never stored recoverably
- **WHEN** a user's credentials are persisted
- **THEN** they are stored only as a salted one-way hash and are not recoverable

### Requirement: Pluggable authentication provider
Authentication SHALL be implemented behind a provider interface such that an external
OIDC provider can be added without changes to session handling, role resolution, or
attribution.

#### Scenario: Provider recorded on the account
- **WHEN** a user account is created
- **THEN** it records which provider authenticated it and an external identifier where one applies

#### Scenario: Adding a provider does not alter authorisation
- **WHEN** an additional authentication provider is configured
- **THEN** per-project roles, API tokens, and write attribution continue to function unchanged

### Requirement: Scoped API tokens
The system SHALL issue revocable API tokens scoped to a project and to a permitted set of
operations, for machine access from CI.

#### Scenario: Token used within its scope
- **WHEN** a request presents a token scoped to a project and to result upload, and targets that project
- **THEN** the request is permitted

#### Scenario: Token used outside its scope
- **WHEN** a request presents a token scoped to one project but targets another
- **THEN** the request is rejected

#### Scenario: Token revoked
- **WHEN** a token is revoked and is subsequently presented
- **THEN** the request is rejected

#### Scenario: Token secrets not recoverable
- **WHEN** a token is issued
- **THEN** its secret is displayed once and is thereafter stored only as a hash, with creation time and last-used time retained

### Requirement: Per-project role-based access control
The system SHALL assign each user a role per project from a defined set of administrator,
lead, tester, and viewer, and SHALL derive every permission decision from that role
rather than from hardcoded identities.

#### Scenario: Access limited to member projects
- **WHEN** a user requests a project in which they hold no role
- **THEN** the request is rejected and the project's existence is not disclosed in listings

#### Scenario: Business user scoped to one project
- **WHEN** a user holds the tester role in one project only
- **THEN** they can execute runs in that project and cannot read any other project

#### Scenario: Viewer cannot modify
- **WHEN** a user holding the viewer role attempts to record a result or edit a case
- **THEN** the action is rejected

#### Scenario: No implicit administrator
- **WHEN** any permission decision is made
- **THEN** it is resolved from the acting user's role in the target project, with no account privileged by identity

### Requirement: Write attribution and provenance
Every write SHALL record the acting user and the interface through which it was made.

#### Scenario: Provenance recorded for each interface
- **WHEN** a case is created through the web interface, the REST API, or the MCP endpoint
- **THEN** the stored record identifies both the acting user and which of those interfaces was used

#### Scenario: Filtering by provenance
- **WHEN** a user filters case history by originating interface
- **THEN** only changes made through that interface are listed
