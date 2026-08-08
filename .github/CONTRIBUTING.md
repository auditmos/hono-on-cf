# Contributing to Hono-on-CF

Thanks for your interest in contributing to Hono-on-CF!
This guide will help you get started.

## Code Style

- Use TypeScript
- Follow existing code patterns

## Feature Implementation Workflow (with Claude Code)

```
┌─────────────────────────────────────────────────────────────┐
│  1. DESIGN                                                  │
│     User: "I need a feature for X"                          │
│     → dd-w agent creates design doc in /docs/NNN-*.md       │
│     → User reviews, iterates if needed                      │
├─────────────────────────────────────────────────────────────┤
│  2. IMPLEMENT                                               │
│     User: "Implement doc NNN"                               │
│     → dd-i agent reads doc, implements across codebase      │
│     → Rules auto-apply based on files being edited          │
├─────────────────────────────────────────────────────────────┤
│  3. DEPLOY                                                  │
│     merge to main      → CI deploys staging                 │
│     push a v*.*.* tag  → CI deploys production              │
└─────────────────────────────────────────────────────────────┘
```

### Claude Code Primitives

| Primitive | Role |
|-----------|------|
| `dd-w` | Writes design docs with full project context |
| `dd-i` | Implements from design docs following all rules |
| `.claude/rules/*` | Auto-load per file path, enforce patterns |
| `*/CLAUDE.md` | Package-specific context |

### Example

```bash
# 1. Design
"Create a design doc for adding a rate-limit override endpoint"

# 2. Review & iterate
"Add an audit log to the design"

# 3. Implement
"Implement doc 003"

# 4. Deploy — merge the PR; CI deploys staging from main.
#    Tag a release when you want it in production.
git tag v1.2.3 && git push origin v1.2.3
```

## Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Test your changes locally
5. Commit with a descriptive message
6. Push and open a PR. Add a detailed description of your changes and attach a screenshot if you made UI changes.
