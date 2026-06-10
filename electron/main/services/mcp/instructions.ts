// Instructions anunciadas no initialize do MCP server. Alcançam TODA sessão
// conectada (inclusive externas via mcp.json) — o Claude Code injeta esse texto
// no contexto do modelo, que passa a manter tasks/features atualizadas
// proativamente durante o trabalho (auto-tracking).
export const SERVER_INSTRUCTIONS = `claude-manager tracks the user's objectives, features, and tasks. While you work, keep tracking up to date — proactively, without being asked.

**Task lifecycle:** When you start work matching an existing task, set it to in_progress (task_update); set it done when finished. Create a task (task_create) for durable work you discover but will not finish now: follow-ups, bugs found, missing tests, pending refactors. Do NOT create tasks for your own internal micro-steps. Before creating, call task_list (keyword search) to avoid duplicates. Always tag auto-created tasks with "auto" and link them to the current feature via links when the feature is known.

**Feature status:** If your system prompt declares a feature id, use it. Otherwise you may resolve it with feature_list, matching by repo path/branch or title; if no confident match, skip feature linking. Call feature_update when state genuinely changes: in-progress on resuming, blocked when stuck on an external dependency, done when the feature's objective is fully met.

Keep updates minimal and factual; never invent progress.`
