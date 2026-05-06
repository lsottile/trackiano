# Skill Registry — telegram-expense-bot

Generated: 2026-05-06

## Project Context

- **Stack**: Node.js
- **Architecture**: Simple script (Telegram bot + Notion API)
- **Testing**: Not configured yet

## User Skills

| Skill | Trigger Context |
|-------|----------------|
| branch-pr | Creating pull requests or preparing changes for review |
| issue-creation | Creating GitHub issues, reporting bugs, requesting features |
| judgment-day | Adversarial dual review of code changes |
| skill-creator | Creating new AI skills or documenting patterns |

## SDD Skills

| Skill | Phase |
|-------|-------|
| sdd-explore | Investigate ideas before committing |
| sdd-propose | Create change proposals |
| sdd-spec | Write specifications |
| sdd-design | Technical design documents |
| sdd-tasks | Break changes into tasks |
| sdd-apply | Implement tasks |
| sdd-verify | Validate implementation |
| sdd-archive | Archive completed changes |

## Compact Rules

### branch-pr
Create branch from issue, use conventional commits, PR title < 70 chars, include test plan.

### issue-creation
Issue-first: always create issue before implementing. Include acceptance criteria.

### judgment-day
Two independent blind judges review simultaneously. Fix all CRITICAL findings before shipping.

## Convention Files

- `~/.claude/CLAUDE.md` — Global rules, persona, language, philosophy
