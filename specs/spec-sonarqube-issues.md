# senad-d_ProtectMe tasks — batch 1

This task spec was generated from active SonarQube issues.

- Sonar project: `senad-d_ProtectMe`
- Organization: `senad-d`
- Active issues read: 17

### 1. Wrap `formatRecentHostLine` map callback

- [x] Resolve Sonar issue `AZ8qAFdy_UQnok-j2D_v`: Do not pass function `formatRecentHostLine` directly to `.map(…)`.

#### Why
Array iterator methods pass the element, index, and array to callbacks. Passing a function reference directly can cause subtle bugs if the referenced function accepts, or later starts accepting, additional parameters.

#### How
Wrap the callback in an arrow function so only the intended argument is passed, for example `items.map(item => formatRecentHostLine(item))`.

#### Where
- `src/ui/protectme-panel/component.ts:441`
- Rule: `typescript:S7727`
- Type/severity: `BUG; MAJOR; impacts: MAINTAINABILITY:HIGH, RELIABILITY:HIGH`

#### Acceptance criteria
- The flagged Sonar issue is remediated at the listed location.
- Intended behavior is preserved.
- Tests passing.

### 2. Combine consecutive array pushes at rendering line 155

- [x] Resolve Sonar issue `AZ8qAFd7_UQnok-j2D_w`: Do not call `Array#push()` multiple times.

#### Why
Multiple consecutive calls to methods that accept multiple arguments create unnecessary overhead, reduce readability, and use an inconsistent pattern for APIs designed to accept multiple values.

#### How
Combine consecutive `Array#push()` calls on the same object into a single call with multiple arguments.

#### Where
- `src/ui/protectme-panel/rendering.ts:155`
- Rule: `typescript:S7778`
- Type/severity: `CODE_SMELL; MINOR; impacts: MAINTAINABILITY:LOW`

#### Acceptance criteria
- The flagged Sonar issue is remediated at the listed location.
- Intended behavior is preserved.
- Tests passing.

### 3. Combine consecutive array pushes at rendering line 176

- [x] Resolve Sonar issue `AZ8qAFd7_UQnok-j2D_y`: Do not call `Array#push()` multiple times.

#### Why
Multiple consecutive calls to methods that accept multiple arguments create unnecessary overhead, reduce readability, and use an inconsistent pattern for APIs designed to accept multiple values.

#### How
Combine consecutive `Array#push()` calls on the same object into a single call with multiple arguments.

#### Where
- `src/ui/protectme-panel/rendering.ts:176`
- Rule: `typescript:S7778`
- Type/severity: `CODE_SMELL; MINOR; impacts: MAINTAINABILITY:LOW`

#### Acceptance criteria
- The flagged Sonar issue is remediated at the listed location.
- Intended behavior is preserved.
- Tests passing.

### 4. Combine consecutive array pushes at rendering line 208

- [x] Resolve Sonar issue `AZ8qAFd7_UQnok-j2D_0`: Do not call `Array#push()` multiple times.

#### Why
Multiple consecutive calls to methods that accept multiple arguments create unnecessary overhead, reduce readability, and use an inconsistent pattern for APIs designed to accept multiple values.

#### How
Combine consecutive `Array#push()` calls on the same object into a single call with multiple arguments.

#### Where
- `src/ui/protectme-panel/rendering.ts:208`
- Rule: `typescript:S7778`
- Type/severity: `CODE_SMELL; MINOR; impacts: MAINTAINABILITY:LOW`

#### Acceptance criteria
- The flagged Sonar issue is remediated at the listed location.
- Intended behavior is preserved.
- Tests passing.

### 5. Combine consecutive array pushes at rendering line 156

- [x] Resolve Sonar issue `AZ8qAFd7_UQnok-j2D_x`: Do not call `Array#push()` multiple times.

#### Why
Multiple consecutive calls to methods that accept multiple arguments create unnecessary overhead, reduce readability, and use an inconsistent pattern for APIs designed to accept multiple values.

#### How
Combine consecutive `Array#push()` calls on the same object into a single call with multiple arguments.

#### Where
- `src/ui/protectme-panel/rendering.ts:156`
- Rule: `typescript:S7778`
- Type/severity: `CODE_SMELL; MINOR; impacts: MAINTAINABILITY:LOW`

#### Acceptance criteria
- The flagged Sonar issue is remediated at the listed location.
- Intended behavior is preserved.
- Tests passing.

### 6. Combine consecutive array pushes at rendering line 177

- [x] Resolve Sonar issue `AZ8qAFd7_UQnok-j2D_z`: Do not call `Array#push()` multiple times.

#### Why
Multiple consecutive calls to methods that accept multiple arguments create unnecessary overhead, reduce readability, and use an inconsistent pattern for APIs designed to accept multiple values.

#### How
Combine consecutive `Array#push()` calls on the same object into a single call with multiple arguments.

#### Where
- `src/ui/protectme-panel/rendering.ts:177`
- Rule: `typescript:S7778`
- Type/severity: `CODE_SMELL; MINOR; impacts: MAINTAINABILITY:LOW`

#### Acceptance criteria
- The flagged Sonar issue is remediated at the listed location.
- Intended behavior is preserved.
- Tests passing.

### 7. Simplify non-linear regex in blocked attempt log line 330

- [x] Resolve Sonar issue `AZ8qAFeF_UQnok-j2D_1`: Simplify this regular expression to reduce its runtime, as it has super-linear performance due to backtracking.

#### Why
Certain regular expressions can cause non-linear backtracking, where evaluation time grows polynomially with input size and can significantly degrade performance on large or untrusted inputs.

#### How
Reduce backtracking by replacing broad `.*` patterns with negated character classes where separators are known, using bounded quantifiers, anchoring when appropriate, and restructuring ambiguous alternations or quantifiers.

#### Where
- `src/logging/blocked-attempt-log.ts:330`
- Rule: `typescript:S8786`
- Type/severity: `CODE_SMELL; MAJOR; impacts: RELIABILITY:MEDIUM`

#### Acceptance criteria
- The flagged Sonar issue is remediated at the listed location.
- Intended behavior is preserved.
- Tests passing.

### 8. Simplify non-linear regex in blocked attempt log line 334

- [x] Resolve Sonar issue `AZ8qAFeF_UQnok-j2D_2`: Simplify this regular expression to reduce its runtime, as it has super-linear performance due to backtracking.

#### Why
Certain regular expressions can cause non-linear backtracking, where evaluation time grows polynomially with input size and can significantly degrade performance on large or untrusted inputs.

#### How
Reduce backtracking by replacing broad `.*` patterns with negated character classes where separators are known, using bounded quantifiers, anchoring when appropriate, and restructuring ambiguous alternations or quantifiers.

#### Where
- `src/logging/blocked-attempt-log.ts:334`
- Rule: `typescript:S8786`
- Type/severity: `CODE_SMELL; MAJOR; impacts: RELIABILITY:MEDIUM`

#### Acceptance criteria
- The flagged Sonar issue is remediated at the listed location.
- Intended behavior is preserved.
- Tests passing.

### 9. Reduce blocked attempt log regex complexity

- [x] Resolve Sonar issue `AZ8qAFeF_UQnok-j2D_3`: Simplify this regular expression to reduce its complexity from 27 to the 20 allowed.

#### Why
Overly complicated regular expressions with many alternations, quantifiers, assertions, groups, or character classes are hard to read, maintain, and can introduce hard-to-find bugs.

#### How
Replace part or all of the regex with regular code, or split the expression into multiple simpler patterns so each pattern remains under the allowed complexity threshold.

#### Where
- `src/logging/blocked-attempt-log.ts:380`
- Rule: `typescript:S5843`
- Type/severity: `CODE_SMELL; MAJOR; impacts: MAINTAINABILITY:MEDIUM`

#### Acceptance criteria
- The flagged Sonar issue is remediated at the listed location.
- Intended behavior is preserved.
- Tests passing.

### 10. Remove loop counter assignment at extractor line 597

- [x] Resolve Sonar issue `AZ8qAFbw_UQnok-j2D_q`: Remove this assignment of "tokenIndex".

#### Why
Assigning loop counters inside the loop body can create unexpected behavior, infinite loops, and control flow that is harder to reason about.

#### How
Update the loop counter only in the loop header/update statement, use `break` for early exit, use `for...of` when only values are needed, or use accepted skip-ahead patterns instead of simple counter assignments.

#### Where
- `src/policy/bash-url-extractor.ts:597`
- Rule: `typescript:S2310`
- Type/severity: `CODE_SMELL; MAJOR; impacts: RELIABILITY:MEDIUM`

#### Acceptance criteria
- The flagged Sonar issue is remediated at the listed location.
- Intended behavior is preserved.
- Tests passing.

### 11. Remove loop counter assignment at extractor line 602

- [x] Resolve Sonar issue `AZ8qAFbw_UQnok-j2D_r`: Remove this assignment of "tokenIndex".

#### Why
Assigning loop counters inside the loop body can create unexpected behavior, infinite loops, and control flow that is harder to reason about.

#### How
Update the loop counter only in the loop header/update statement, use `break` for early exit, use `for...of` when only values are needed, or use accepted skip-ahead patterns instead of simple counter assignments.

#### Where
- `src/policy/bash-url-extractor.ts:602`
- Rule: `typescript:S2310`
- Type/severity: `CODE_SMELL; MAJOR; impacts: RELIABILITY:MEDIUM`

#### Acceptance criteria
- The flagged Sonar issue is remediated at the listed location.
- Intended behavior is preserved.
- Tests passing.

### 12. Remove loop counter assignment at extractor line 625

- [x] Resolve Sonar issue `AZ8qAFbw_UQnok-j2D_s`: Remove this assignment of "tokenIndex".

#### Why
Assigning loop counters inside the loop body can create unexpected behavior, infinite loops, and control flow that is harder to reason about.

#### How
Update the loop counter only in the loop header/update statement, use `break` for early exit, use `for...of` when only values are needed, or use accepted skip-ahead patterns instead of simple counter assignments.

#### Where
- `src/policy/bash-url-extractor.ts:625`
- Rule: `typescript:S2310`
- Type/severity: `CODE_SMELL; MAJOR; impacts: RELIABILITY:MEDIUM`

#### Acceptance criteria
- The flagged Sonar issue is remediated at the listed location.
- Intended behavior is preserved.
- Tests passing.

### 13. Remove loop counter assignment at extractor line 630

- [x] Resolve Sonar issue `AZ8qAFbw_UQnok-j2D_t`: Remove this assignment of "tokenIndex".

#### Why
Assigning loop counters inside the loop body can create unexpected behavior, infinite loops, and control flow that is harder to reason about.

#### How
Update the loop counter only in the loop header/update statement, use `break` for early exit, use `for...of` when only values are needed, or use accepted skip-ahead patterns instead of simple counter assignments.

#### Where
- `src/policy/bash-url-extractor.ts:630`
- Rule: `typescript:S2310`
- Type/severity: `CODE_SMELL; MAJOR; impacts: RELIABILITY:MEDIUM`

#### Acceptance criteria
- The flagged Sonar issue is remediated at the listed location.
- Intended behavior is preserved.
- Tests passing.

### 14. Reduce extractor function cognitive complexity from 18

- [x] Resolve Sonar issue `AZ8qAFbw_UQnok-j2D_n`: Refactor this function to reduce its Cognitive Complexity from 18 to the 15 allowed.

#### Why
High cognitive complexity makes control flow harder to understand, test, modify, and maintain. It commonly indicates code should be decomposed into smaller, easier-to-manage pieces.

#### How
Extract complex conditions into well-named functions, break the function into smaller single-responsibility functions, reduce nesting with early returns, and use null-safe operations where applicable.

#### Where
- `src/policy/bash-url-extractor.ts:203`
- Rule: `typescript:S3776`
- Type/severity: `CODE_SMELL; CRITICAL; impacts: MAINTAINABILITY:HIGH`

#### Acceptance criteria
- The flagged Sonar issue is remediated at the listed location.
- Intended behavior is preserved.
- Tests passing.

### 15. Reduce extractor function cognitive complexity from 17

- [x] Resolve Sonar issue `AZ8qAFbw_UQnok-j2D_o`: Refactor this function to reduce its Cognitive Complexity from 17 to the 15 allowed.

#### Why
High cognitive complexity makes control flow harder to understand, test, modify, and maintain. It commonly indicates code should be decomposed into smaller, easier-to-manage pieces.

#### How
Extract complex conditions into well-named functions, break the function into smaller single-responsibility functions, reduce nesting with early returns, and use null-safe operations where applicable.

#### Where
- `src/policy/bash-url-extractor.ts:252`
- Rule: `typescript:S3776`
- Type/severity: `CODE_SMELL; CRITICAL; impacts: MAINTAINABILITY:HIGH`

#### Acceptance criteria
- The flagged Sonar issue is remediated at the listed location.
- Intended behavior is preserved.
- Tests passing.

### 16. Use concise word character class in extractor regex

- [x] Resolve Sonar issue `AZ8qAFbw_UQnok-j2D_p`: Use concise character class syntax '\w' instead of '[A-Za-z0-9_]'.

#### Why
Regular expressions are easier to read and maintain when concise shorthand character classes are used for widely recognized equivalents.

#### How
Replace `[A-Za-z0-9_]` with `\w` in the flagged regular expression.

#### Where
- `src/policy/bash-url-extractor.ts:369`
- Rule: `typescript:S6353`
- Type/severity: `CODE_SMELL; MINOR; impacts: MAINTAINABILITY:LOW`

#### Acceptance criteria
- The flagged Sonar issue is remediated at the listed location.
- Intended behavior is preserved.
- Tests passing.

### 17. Simplify non-linear regex in host normalization

- [x] Resolve Sonar issue `AZ8qAFdo_UQnok-j2D_u`: Simplify this regular expression to reduce its runtime, as it has super-linear performance due to backtracking.

#### Why
Certain regular expressions can cause non-linear backtracking, where evaluation time grows polynomially with input size and can significantly degrade performance on large or untrusted inputs.

#### How
Reduce backtracking by replacing broad `.*` patterns with negated character classes where separators are known, using bounded quantifiers, anchoring when appropriate, and restructuring ambiguous alternations or quantifiers.

#### Where
- `src/policy/host-normalization.ts:112`
- Rule: `typescript:S8786`
- Type/severity: `CODE_SMELL; MAJOR; impacts: RELIABILITY:MEDIUM`

#### Acceptance criteria
- The flagged Sonar issue is remediated at the listed location.
- Intended behavior is preserved.
- Tests passing.
