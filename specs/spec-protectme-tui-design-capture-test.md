# Plan: ProtectMe TUI design capture test

## Task Description
Create an automated TUI design capture test for the ProtectMe `/protectme` panel. The test must render the available panel layouts, states, actions, and setting selections into a deterministic markdown output file so the current application configuration UI can be reviewed later without opening a live Pi TUI session.

Task type: enhancement

Complexity: medium

## Objective
When this plan is implemented, a developer can run a focused Node test and receive a human-readable TUI design artifact showing how ProtectMe configuration looks across all implemented panel windows: wide, narrow, tiny, each setting selection, project/global write targets, representative config states, and action/status states.

## Problem Statement
Current tests in `test/protectme-panel.test.mjs` assert important line-width and content expectations, but they do not produce a review artifact. Reviewing the full configuration UI still requires either reading code or manually opening `/protectme` in Pi. The project needs a repeatable design-capture test that shows what the UI looks like in all implemented layout modes and important state variants.

## Investigation Summary
The current UI surface is concentrated in `src/ui/protectme-panel.ts`:

- `/protectme` opens only when `ctx.mode === "tui"`; non-TUI modes receive a warning notification.
- `ProtectMePanelComponent.render(width)` has three width windows:
  - tiny: width `<= 23`, four-line no-border fallback,
  - narrow: width `24..71`, framed one-pane layout,
  - wide: width `>= 72`, framed two-pane layout.
- The panel currently has one category, `Configuration`, with ten settings:
  1. Effective mode
  2. Write target
  3. Add allow-list entry
  4. Remove allow-list entry
  5. Global config path
  6. Project config path
  7. Global site count
  8. Project site count
  9. Effective site count
  10. Recent blocked hosts
- Selection changes alter the visible marker and footer text, so every setting index must be captured at least once.
- The panel supports project/global write target changes, mode toggles, add/remove entry actions, success/error status footers, and nested Pi `select`/`editor` prompts. The nested prompts are Pi-provided UI, so this test should capture their invocation metadata rather than trying to snapshot Pi internals.
- `docs/configuration-tui-design-standard.md` defines the intended visual language: framed wide/narrow windows, no-border tiny fallback, `▶ ` selection marker, ` • ` footer separator, right-aligned values, and no rendered line exceeding terminal width.
- Pi TUI docs require component lines to fit the render width and recommend deterministic component rendering with `invalidate()` after state changes.

## Solution Approach
Add a focused design-capture test that renders `ProtectMePanelComponent` with deterministic fake config states and a plain theme. The test will write a markdown report to an ignored local output path, then assert that the report and individual renders satisfy design-review invariants.

Recommended generated output path:

```text
tmp/protectme-tui-design/protectme-panel-design.md
```

Allow overriding the destination with:

```text
PROTECTME_TUI_DESIGN_OUTPUT=/custom/path.md
```

The output should be plain Unicode text without ANSI escapes so it can be reviewed in any editor, copied into issues, or attached to PRs.

## Relevant Files
Use these files to complete the task:

- `src/ui/protectme-panel.ts` - source of the renderable panel component, width breakpoints, keyboard actions, and action/status behavior.
- `test/protectme-panel.test.mjs` - existing panel tests and fixture patterns that can guide fake states and action flushing.
- `docs/configuration-tui-design-standard.md` - visual contract to reflect in capture coverage and assertions.
- `docs/manual-smoke-test.md` - add a short note about the automated design-capture artifact if desired.
- `README.md` - optional development-validation note for the new focused command.
- `CHANGELOG.md` - record the new design-capture test under `0.1.0 - Unreleased`.
- `.gitignore` - already ignores `tmp/`; no new ignore rule is needed if the recommended output path is used.

### New Files

- `test/protectme-panel-design-capture.test.mjs` - new Node test that renders the matrix and writes the markdown artifact.

Optional only if fixture reuse becomes noisy:

- `test/helpers/protectme-panel-fixtures.mjs` - shared test fixture builders for panel states, fake action UI, and plain theme. Keep helpers top-level; do not nest functions.

## Implementation Phases

### Phase 1: Capture Matrix Foundation
Define deterministic fixture builders and a capture model that names each rendered state. Keep all fake paths, hosts, and errors synthetic so the output never exposes local secrets.

### Phase 2: Core Design Capture Test
Render the matrix into markdown, write it to `tmp/protectme-tui-design/protectme-panel-design.md`, and assert coverage of width windows, settings, write targets, config states, and action metadata.

### Phase 3: Documentation and Validation Polish
Document the focused command, update the changelog, and run the focused test plus full validation commands.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Define the Capture Scope
- Add a top-level `CAPTURE_WIDTHS` array in the new test with representative widths:
  - `wide-review` at `96`,
  - `wide-min` at `72`,
  - `narrow-max` at `71`,
  - `narrow-review` at `50`,
  - `narrow-min` at `24`,
  - `tiny-max` at `23`,
  - `tiny-review` at `12`.
- Add a separate automated width-safety sweep for widths `1..120`; this sweep should assert every rendered line fits but should not dump all widths into the review artifact.
- Define capture state builders for:
  - valid block mode with recent blocked hosts,
  - project `allow` mode overriding global `block`,
  - ignored untrusted project config,
  - missing/default config,
  - invalid/unreadable fail-closed config metadata,
  - long path and long host values for truncation review.

### 2. Capture Every Current Setting Selection
- Use the valid block-mode state to render every selected setting index from `0` through `9` at least once.
- Capture these selections in both a wide review width and a narrow review width.
- Include the selected setting name, index, write target, and width in each markdown section heading.
- Assert that every current setting label appears in the output at least once:
  - `Effective mode`
  - `Write target`
  - `Add allow-list entry`
  - `Remove allow-list entry`
  - `Global config path`
  - `Project config path`
  - `Global site count`
  - `Project site count`
  - `Effective site count`
  - `Recent blocked hosts`

### 3. Capture Width Window Snapshots
- For each width in `CAPTURE_WIDTHS`, render the baseline valid block-mode state.
- In the report, group these under a `Responsive Windows` section.
- Assert mode-specific visual structure:
  - wide captures include the middle pane separator `┬`,
  - narrow captures do not include `┬` but do include an outer frame,
  - tiny captures do not include border characters and include `q quit`.

### 4. Capture Configuration State Variants
- Render each state builder at the wide review width and narrow review width.
- Include a short metadata block before each viewport:
  - effective mode,
  - global/project status,
  - effective allow-list count,
  - recent blocked hosts count,
  - selected write target.
- Assert the output contains visible markers for important states:
  - `project config ignored`,
  - `mode allow` or `effective allow`,
  - zero-site/default config state,
  - long-path truncation with `…`.

### 5. Capture Write Target and Status States
- Render baseline state with write target `project` and `global`.
- Drive keyboard input (`g`, `p`, `m`, `a`, `r`, Enter on selected rows) through `ProtectMePanelComponent.handleInput()` where appropriate.
- Capture at least these post-input panel states:
  - write target switched to global,
  - write target switched back to project,
  - in-flight save footer (`Saving ProtectMe config…`) immediately after an async action starts,
  - successful mode toggle footer,
  - failed write footer.
- Use explicit fake dependencies that make async action behavior deterministic.

### 6. Capture Nested Action Metadata
- For Pi-provided nested dialogs, capture the fake UI call data rather than trying to render Pi internals:
  - write-target `select` title and options,
  - add-entry `editor` title and prefilled recent blocked host suggestion,
  - remove-entry `select` title and options for project and global targets,
  - notifications emitted for success and errors.
- Add a `Nested Action Invocations` section to the markdown report.
- Assert every expected nested action title appears in the report.

### 7. Write the Markdown Design Artifact
- Build a deterministic markdown string with this structure:

````md
# ProtectMe TUI Design Capture

Generated by: test/protectme-panel-design-capture.test.mjs
Output policy: synthetic fixtures only; no real user config paths.

## Responsive Windows
### wide-review / width 96
```text
...
```

## Setting Selection Coverage
...

## Configuration State Variants
...

## Action and Status States
...

## Nested Action Invocations
...
````

- Ensure fenced code blocks preserve the exact rendered viewport lines.
- Ensure the output ends with a newline.
- Create the destination directory with `mkdir(..., { recursive: true })` before writing.

### 8. Add Automated Assertions
- Assert the output file exists after the test writes it.
- Assert no viewport line exceeds its requested width using `visibleWidth` from `@earendil-works/pi-tui`.
- Assert the markdown output contains no ANSI escape sequences and no terminal control characters except newlines and tabs inside markdown if needed.
- Assert all capture IDs are unique.
- Assert all current settings, responsive windows, state variants, status states, and nested action invocations are represented.
- Assert the test uses only synthetic fixture paths and hosts.

### 9. Document the Review Command
- Add a concise note to `docs/manual-smoke-test.md` or `README.md` with the focused command:

```bash
node --test test/protectme-panel-design-capture.test.mjs
```

- Mention the default output path:

```text
tmp/protectme-tui-design/protectme-panel-design.md
```

- Make clear that the file is generated local review output and should not be published or committed unless intentionally requested.

### 10. Update Changelog
- Add an entry under `0.1.0 - Unreleased` describing the new automated ProtectMe TUI design capture test and markdown review artifact.

### 11. Validate the Work
- Run the focused design-capture test.
- Run the existing panel tests.
- Run the full project validation commands listed below.
- Open the generated markdown once and verify it is readable, grouped, and useful for reviewing the UI design.

## Testing Strategy
This task is itself a test enhancement. The test should combine human-review snapshots with automated invariants:

- Human review: deterministic markdown viewports for all implemented TUI windows and important states.
- Automated contract checks: line width, section coverage, state coverage, no ANSI/control characters, synthetic-only fixture data, and expected nested dialog metadata.
- Regression safety: if the panel changes setting labels, width breakpoints, or action titles, the test should fail until the capture matrix and report are intentionally updated.

## Acceptance Criteria
- A focused Node test writes a deterministic markdown artifact showing ProtectMe TUI design captures.
- The artifact includes wide, narrow, and tiny windows.
- The artifact includes every current setting selected at least once.
- The artifact includes project and global write targets.
- The artifact includes representative valid, allow, ignored project, missing/default, fail-closed, and long-value config states.
- The artifact includes action/status states for target switching, saving, success, and failure.
- The artifact records nested select/editor action metadata for later review.
- Every rendered viewport line fits its requested width.
- Generated output uses only synthetic data and contains no ANSI escapes or unsafe terminal controls.
- `CHANGELOG.md` is updated.
- Focused and full validation commands pass.

## Validation Commands
Execute these commands to validate the task is complete:

- `node --test test/protectme-panel-design-capture.test.mjs` - generate and validate the TUI design capture artifact.
- `test -f tmp/protectme-tui-design/protectme-panel-design.md` - verify the default artifact was written.
- `node --test test/protectme-panel.test.mjs` - verify existing panel behavior still passes.
- `npm run typecheck` - verify TypeScript compiles.
- `npm run test` - run the full Node test suite.
- `npm run format:check` - verify markdown and source formatting rules.
- `npm run check:pack` - verify generated artifacts are not published.
- `npm run validate` - run the full repository validation chain.

## Notes
- Do not run a live Pi TUI session from this test; use `ProtectMePanelComponent` directly for deterministic rendering.
- Do not snapshot Pi built-in `select` or `editor` dialogs. Capture the fake UI invocation metadata because those dialogs are owned by Pi, not ProtectMe.
- Keep helper functions top-level to follow the repository preference to avoid nested functions.
- Use a plain theme for the review artifact so the markdown is readable everywhere.
- If future settings are added, the capture test should fail until the expected settings list and matrix are updated.

## Spec Review Checklist
- The plan reflects the actual current UI in `src/ui/protectme-panel.ts` rather than the broader reusable design template.
- The plan covers all implemented render windows: wide, narrow, and tiny.
- The plan covers all current setting rows and important config/action states.
- The generated artifact path is ignored by the repository and excluded from package contents.
- The test can run without credentials, network access, real Pi runtime interaction, or real user configuration files.
