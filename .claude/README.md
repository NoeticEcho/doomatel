# Claude Code configuration for Doomatel

## Установленные плагины (marketplaces)

| Marketplace | Repo | Плагины |
|---|---|---|
| `superpowers-dev` | `obra/superpowers` | `superpowers` — TDD, systematic debugging, brainstorming, writing/executing plans, subagent-driven development |
| `anthropic-agent-skills` | `anthropics/skills` | `example-skills` — mcp-builder, skill-creator, webapp-testing и др. |
| `claude-code-workflows` | `wshobson/agents` | `llm-application-dev`, `database-design`, `backend-development`, `frontend-mobile-development`, `security-scanning`, `agent-orchestration` |

Установка на новой машине выполняется автоматически из `settings.json`
(Claude Code подтянет marketplaces и включит плагины). Вручную:

```bash
claude plugin marketplace add obra/superpowers
claude plugin install superpowers@superpowers-dev
claude plugin marketplace add anthropics/skills
claude plugin install example-skills@anthropic-agent-skills
claude plugin marketplace add wshobson/agents
claude plugin install llm-application-dev@claude-code-workflows
```

## MCP-серверы

MCP-серверы проекта описаны в `.mcp.json` в корне репозитория.
