## Purpose

Exposes the read-only capabilities of the Ludao material-sharing site — search,
resource detail, and download-to-disk — as MCP tools, so an agent can find study
materials and retrieve them without leaving the conversation.

## ADDED Requirements

### Requirement: Library Layer is opt-in via an explicit flag

The system SHALL expose the Library Layer's tools only when the `LUDAO_ENABLED`
setting is on. An unset or empty value SHALL be treated as off. The value is
parsed case-insensitively: `true`, `1`, `yes`, and `on` mean on; every other
value means off. The flag SHALL be independent of whether a token is configured.

#### Scenario: Flag absent

- **WHEN** the server starts with `LUDAO_ENABLED` unset or empty
- **THEN** `listTools` returns no Library Layer tool
- **AND** calling a Library Layer tool name fails as an unknown tool

#### Scenario: Flag off with an explicit false-ish value

- **WHEN** `LUDAO_ENABLED` is `false`, `0`, `no`, or `off` in any letter case
- **THEN** `listTools` returns no Library Layer tool

#### Scenario: Flag on

- **WHEN** `LUDAO_ENABLED` is `true`, `1`, `yes`, or `on` in any letter case
- **THEN** `listTools` includes `ludao_search`, `ludao_resource`, and
  `ludao_download`

#### Scenario: Flag on without a token

- **WHEN** the flag is on and no token is configured
- **THEN** all three tools remain callable and operate against public resources

### Requirement: Material search returns resources by default

The system SHALL provide a material search tool over the site's full-text
search, accepting a query plus optional category filter, tag filter, subtree
restriction, and page number. Unless the caller explicitly asks for categories,
results SHALL contain materials only. Each result SHALL carry the material's
resource id, title/course, size, and rating so a download can be driven
directly from it. The search endpoint reports no part count, so no part count
SHALL appear in search output. Result text SHALL be truncated with a labelled
count when it exceeds the layer's character budget.

#### Scenario: Plain query

- **WHEN** the tool is called with only a query
- **THEN** materials matching the query are returned, each line showing its
  resource id, course/title, size, and rating

#### Scenario: Restricting to a category subtree

- **WHEN** the tool is called with a query and a category id restriction
- **THEN** only materials under that category subtree are returned

#### Scenario: Asking for categories

- **WHEN** the tool is called with the category result type
- **THEN** matching categories are returned instead of materials

#### Scenario: Empty or failed search

- **WHEN** the query matches nothing or the site returns an error
- **THEN** the tool reports the site's error message, or that no material
  matched, without exposing raw transport errors

### Requirement: Resource detail reports metadata and social signals

The system SHALL provide a tool that reads one material by resource id and
reports its metadata (filename, course, term, type word, size, download count,
status) together with its rating summary. The site's comment feature is
offline, so when the site returns no review list the tool SHALL state that
explicitly instead of showing an empty section or failing.
Category ids and resource ids SHALL NOT be interchangeable, and passing a
category id SHALL be reported as "not found" rather than crashing.

#### Scenario: Existing public resource

- **WHEN** the tool is called with the id of a public material
- **THEN** the metadata and the rating summary are returned

#### Scenario: No reviews on the site

- **WHEN** the site returns no review list for the material
- **THEN** the output states that the site has no reviews for it, and the rest
  of the detail is still returned

#### Scenario: Non-public or missing resource

- **WHEN** the tool is called with an id that does not exist or is not visible
  to the caller
- **THEN** the tool reports that the material was not found

### Requirement: Download writes the complete file to local disk

The system SHALL provide a tool that resolves a material's download plan and
writes the complete file to a local directory. The default directory SHALL be
`./downloads` relative to the server process's working directory and SHALL be
overridable by configuration. Mirrors SHALL be tried in the order the download
plan lists them, each attempt bounded by a timeout, and the plan's final GitHub
direct link SHALL be the last resort. When a material is stored in multiple
parts, the parts SHALL be fetched and concatenated in part order into a single
file. The result SHALL report the absolute output path, the byte count, the
number of parts, and which mirror served the bytes.

#### Scenario: Single-part material

- **WHEN** the tool is called with the id of a one-part public material
- **THEN** the file is written under the download directory and the result
  reports its path, size, and the mirror that served it

#### Scenario: Multi-part material

- **WHEN** the tool is called with the id of a multi-part material
- **THEN** every part is fetched and concatenated in part order into one file
  whose size matches the material's total size

#### Scenario: First mirror slow or broken

- **WHEN** an earlier mirror times out or refuses the request
- **THEN** the next mirror in the plan is tried, and the result names the mirror
  that finally served the bytes

#### Scenario: Every mirror fails

- **WHEN** no mirror in the plan can serve the file
- **THEN** the tool returns an error naming the resource id and the last failure
  reason, and no partial file is left behind

#### Scenario: Output name already taken

- **WHEN** a file with the material's filename already exists in the download
  directory
- **THEN** the new file is written under a distinct suffixed name, and the
  existing file is left untouched

### Requirement: Downloaded filenames are confined to the download directory

The filename used for the output file SHALL be derived from the download plan's
filename but SHALL be reduced to a single path segment. Directory components,
parent-directory references, and path separators SHALL NOT influence where the
file is written, so output always lands inside the configured download
directory.

#### Scenario: Hostile filename in the plan

- **WHEN** the download plan's filename contains path separators or
  parent-directory segments
- **THEN** the file is still written inside the download directory under a
  sanitised single-segment name

### Requirement: The token is optional, read once, and never logged

The personal token SHALL be read from the environment in the single
configuration module and forwarded to the site as a bearer credential. No token
SHALL be written to any log line, tool output, or artifact. When no token is
present the layer SHALL run in guest mode: public materials remain searchable,
readable, and downloadable, while materials in non-public states are invisible.
An invalid or revoked token SHALL degrade to guest behaviour rather than
failing the request.

#### Scenario: Valid token configured

- **WHEN** requests are made with a valid token
- **THEN** the token is sent as the authorization credential and materials
  visible to the token's owner are reachable

#### Scenario: Token invalid or revoked

- **WHEN** the configured token is rejected by the site
- **THEN** tools keep working against public materials, and no tool output or
  log line contains the token value

### Requirement: The site base URL is overridable

The layer SHALL target the default Ludao site unless a base URL override is
configured. An empty override SHALL fall back to the default site.

#### Scenario: Override set

- **WHEN** a base URL override is configured
- **THEN** all requests go to the overridden site

#### Scenario: Override empty

- **WHEN** the override is unset or empty
- **THEN** requests go to the default Ludao site

### Requirement: Site errors surface as tool errors with actionable hints

Failures from the site SHALL be reported as tool errors carrying the site's own
message and HTTP status. Authorization failures SHALL hint that the token may be
missing, revoked, or under-privileged; rate-limit failures SHALL hint at
back-off.

#### Scenario: Permission denied

- **WHEN** the site rejects a request for lack of permission
- **THEN** the tool error names the site message and suggests checking the
  configured token and its role

#### Scenario: Rate limited

- **WHEN** the site reports the caller is too frequent
- **THEN** the tool error reports the rate-limit message and suggests retrying
  later

### Requirement: No state-changing operation is exposed

The Library Layer SHALL expose no tool that creates, edits, or deletes site
data. Commenting, rating, reporting, uploading, and moderation endpoints SHALL
NOT be reachable through the layer.

#### Scenario: Only read tools listed

- **WHEN** the layer is exposed
- **THEN** the exposed tool set contains exactly the search, resource-detail,
  and download tools, and none of them can alter site state
