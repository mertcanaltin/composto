---
name: composto-scan
description: Scan the codebase for security issues, debug artifacts, and code smells. Use before starting work or when asked to check code quality.
---

# Composto Scan

Scan the current project for issues using Composto's Watcher Engine.

## How to Run

Execute this command in the project root:

```bash
npx composto scan .
```

Or if composto is installed globally:

```bash
composto scan .
```

## What It Finds

- **Security**: Hardcoded secrets (API keys, tokens, passwords)
- **Debug Artifacts**: `console.log`, `console.debug` left in source code
- **Context-Aware Severity**: Same issue has different severity in `src/` vs `tests/`

## Reading the Output

```
!! [CRITICAL] src/auth/login.ts:23
   Potential hardcoded secret detected
   -> Route: reviewer @ L1

 ! [WARNING] src/utils/helper.ts:15
   console.log detected — likely debug artifact
   -> Route: fixer @ L1
```

- `!!` = critical, needs immediate attention
- ` !` = warning, should be fixed
- `  ` = info, for awareness

## After Scanning

- Fix critical issues immediately
- Batch warnings for end of session
- Use `composto-ir` to get Health-Aware context for files with issues
