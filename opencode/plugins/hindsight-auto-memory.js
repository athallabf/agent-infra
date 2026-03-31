/**
 * Hindsight Auto-Memory Plugin v2 for OpenCode
 *
 * Selective retention — only remembers novel, high-signal information.
 * Three automation layers:
 *   1. tool.execute.after — smart fact extraction from tool executions
 *   2. session.idle — session summary retention
 *   3. experimental.session.compacting — inject recalled context before compaction
 *
 * Custom tools:
 *   hindsight_retain, hindsight_recall, hindsight_reflect
 */

const HINDSIGHT_API = process.env.HINDSIGHT_API_URL || "http://localhost:8888";
const AGENT_BANK = "agent-self";
const PROJECT_BANK = "project-kb";

const processedToolCalls = new Set();
const seenErrors = new Set();
const seenFiles = new Set();

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function hs(bank, method, path, body) {
  const url = `${HINDSIGHT_API}/v1/default/banks/${bank}${path}`;
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const resp = await fetch(url, opts);
  if (!resp.ok) throw new Error(`Hindsight ${resp.status}: ${await resp.text().catch(() => "")}`);
  return resp.json();
}

function retain(bank, content, context, tags) {
  return hs(bank, "POST", "/memories", {
    items: [{ content, context, tags: tags || [] }],
  }).then(() => true).catch(() => false);
}

function recall(bank, query, maxTokens) {
  return hs(bank, "POST", "/memories/recall", {
    query, max_tokens: maxTokens || 2048, budget: "mid",
  }).catch(() => ({ results: [] }));
}

function reflect(bank, query, context) {
  return hs(bank, "POST", "/reflect", { query, context, budget: "mid" }).catch(() => ({}));
}

// ---------------------------------------------------------------------------
// Selective fact extraction — only high-signal events
// ---------------------------------------------------------------------------

function extractFacts(toolName, args, result) {
  const facts = [];

  switch (toolName) {
    case "write":
    case "edit": {
      const file = args?.filePath || args?.path;
      if (!file) break;

      // First-time file creation of significant files
      if (!seenFiles.has(file) && file.match(/\.(ts|js|py|go|rs|tsx|jsx|vue|svelte|md|json|yaml|toml)$/)) {
        seenFiles.add(file);
        if (seenFiles.size > 200) {
          const keys = Array.from(seenFiles);
          keys.slice(0, 100).forEach(k => seenFiles.delete(k));
        }
        facts.push({
          content: `Created or first-modified file: ${file}`,
          context: "file-creation",
          tags: ["file-new", file],
          bank: PROJECT_BANK,
        });
      }
      break;
    }

    case "bash": {
      const cmd = args?.command || "";

      // Package installs — always retain
      const installMatch = cmd.match(/(?:npm|pip|yarn|bun|cargo|go)\s+(?:install|add)\s+(\S+)/);
      if (installMatch) {
        facts.push({
          content: `Installed dependency: ${installMatch[1]} via ${cmd.split(/\s+/)[0]}`,
          context: "dependencies",
          tags: ["dependency", "install"],
          bank: PROJECT_BANK,
        });
      }

      // Docker operations
      if (cmd.startsWith("docker") && (cmd.includes("run") || cmd.includes("build") || cmd.includes("compose"))) {
        facts.push({
          content: `Docker command: ${cmd.slice(0, 300)}`,
          context: "infrastructure",
          tags: ["docker", "infrastructure"],
          bank: PROJECT_BANK,
        });
      }

      // Git operations with meaningful output
      if (cmd.startsWith("git") && result && typeof result === "string" && result.length > 10) {
        const resultPreview = result.slice(0, 400);
        facts.push({
          content: `Git operation "${cmd.slice(0, 80)}" result: ${resultPreview}`,
          context: "version-control",
          tags: ["git", "vcs"],
          bank: PROJECT_BANK,
        });
      }
      break;
    }

    case "question": {
      // User answers to clarification questions = explicit preferences
      if (result) {
        const resultStr = typeof result === "string" ? result : JSON.stringify(result).slice(0, 300);
        if (resultStr.length > 5) {
          facts.push({
            content: `User preference/decision: ${resultStr.slice(0, 300)}`,
            context: "user-preferences",
            tags: ["preference", "decision"],
            bank: AGENT_BANK,
          });
        }
      }
      break;
    }

    case "edit": {
      // Large edits that change architecture
      const oldStr = args?.oldString || "";
      const newStr = args?.newString || "";
      if (oldStr.length > 100 && newStr.length > 100) {
        const file = args?.filePath || args?.path || "";
        facts.push({
          content: `Significant refactor in ${file}: replaced ${oldStr.length} chars with ${newStr.length} chars`,
          context: "refactoring",
          tags: ["refactor", file],
          bank: PROJECT_BANK,
        });
      }
      break;
    }
  }

  // Error tracking — only novel errors (deduplicated by tool + first 100 chars of message)
  if (result && typeof result === "string" && (result.includes("ERROR") || result.includes("Error:") || result.includes("failed"))) {
    const errorKey = `${toolName}:${result.slice(0, 100)}`;
    if (!seenErrors.has(errorKey)) {
      seenErrors.add(errorKey);
      if (seenErrors.size > 100) {
        const keys = Array.from(seenErrors);
        keys.slice(0, 50).forEach(k => seenErrors.delete(k));
      }
      const file = args?.filePath || args?.path || "";
      facts.push({
        content: `Novel error in ${toolName}${file ? ` on ${file}` : ""}: ${result.slice(0, 400)}`,
        context: "errors",
        tags: ["error", "novel", toolName],
        bank: AGENT_BANK,
      });
    }
  }

  return facts;
}

// ---------------------------------------------------------------------------
// Session summary builder
// ---------------------------------------------------------------------------

function buildSessionSummary(session) {
  const messages = session.messages || [];
  const tools = session.tools || [];
  const userMsg = messages.filter(m => m.role === "user").slice(-1)[0]?.content || "N/A";
  const errors = tools.filter(t => t.error);
  const fileEdits = tools.filter(t => ["write", "edit", "create"].includes(t.name || t.tool));

  const filesTouched = new Set();
  tools.forEach(t => {
    const p = t.args?.filePath || t.args?.path || t.args?.file;
    if (p) filesTouched.add(p);
  });

  const decisions = [];
  messages.filter(m => m.role === "assistant").slice(-5).forEach(msg => {
    const c = msg.content || "";
    [/chose (.*?) because/i, /decided to (.*?) since/i, /best approach: (.*)/i].forEach(p => {
      const m = c.match(p);
      if (m) decisions.push(m[0].slice(0, 150));
    });
  });

  return [
    `Task: ${userMsg.slice(0, 500)}`,
    `Tools: ${tools.length} | Edits: ${fileEdits.length} | Errors: ${errors.length}`,
    filesTouched.size > 0 ? `Files: ${Array.from(filesTouched).slice(0, 10).join(", ")}` : "",
    decisions.length > 0 ? `Decisions: ${decisions.join("; ")}` : "",
    errors.length > 0 ? `Errors: ${errors.slice(0, 3).map(e => `${e.name || e.tool}: ${(e.error?.message || e.error || "").slice(0, 100)}`).join("; ")}` : "",
  ].filter(Boolean).join("\n");
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export const HindsightAutoMemory = async ({ client, $ }) => {
  let available = false;
  try {
    const resp = await fetch(`${HINDSIGHT_API}/health`);
    if (resp.ok) available = true;
  } catch { /* silent */ }

  return {
    "tool.execute.after": async (input) => {
      if (!available) return;

      const callId = input.callID;
      if (callId && processedToolCalls.has(callId)) return;
      if (callId) processedToolCalls.add(callId);
      if (processedToolCalls.size > 500) {
        const keys = Array.from(processedToolCalls);
        keys.slice(0, 200).forEach(k => processedToolCalls.delete(k));
      }

      const facts = extractFacts(input.tool, input.args || {}, input.result);
      for (const f of facts) {
        await retain(f.bank, f.content, f.context, f.tags);
      }
    },

    "session.idle": async ({ session }) => {
      if (!available) return;
      const summary = buildSessionSummary(session);
      if (!summary || summary.length < 30) return;

      const sid = session.id || "unknown";
      await retain(AGENT_BANK, summary, "session-summary", ["session-summary", sid]);
      await retain(PROJECT_BANK, summary, "session-summary", ["session-summary", sid]);
    },

    "experimental.session.compacting": async (input, output) => {
      if (!available) return;
      const messages = input.messages || [];
      const lastUser = messages.filter(m => m.role === "user").pop();
      if (!lastUser) return;

      const query = lastUser.content?.slice(0, 200);
      if (!query) return;

      try {
        const memories = await recall(AGENT_BANK, query, 1024);
        if (memories?.results?.length > 0) {
          const ctx = memories.results.map(r => r.content || r.text || JSON.stringify(r)).join("\n");
          output.context.push(`\n## Hindsight Memory Context\n${ctx}\n`);
        }
      } catch { /* don't break compaction */ }
    },

    tool: {
      hindsight_retain: {
        description: "Store a fact to Hindsight long-term memory. Use when you learn something important about the user, project, or codebase that should persist across sessions.",
        parameters: {
          type: "object",
          properties: {
            content: { type: "string", description: "The fact to remember. Write in clear, standalone sentences." },
            bank: { type: "string", description: "Memory bank. 'agent-self' for user/agent knowledge. 'project-kb' for project knowledge.", enum: ["agent-self", "project-kb"], default: "agent-self" },
            context: { type: "string", description: "Category (e.g., 'preferences', 'architecture', 'debugging')." },
            tags: { type: "array", items: { type: "string" }, description: "Tags for organizing." },
          },
          required: ["content"],
        },
        async execute(args) {
          if (!available) return "Hindsight server is not running. Start it with: docker run -d --name hindsight --restart unless-stopped -p 8888:8888 ghcr.io/vectorize-io/hindsight:latest";
          const bank = args.bank || AGENT_BANK;
          const ok = await retain(bank, args.content, args.context, args.tags);
          return ok ? `Retained to ${bank}: "${args.content}"` : `Failed to retain to ${bank}`;
        },
      },

      hindsight_recall: {
        description: "Search Hindsight long-term memory for relevant context. Use before starting work to recall past decisions, user preferences, or project knowledge.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Natural language search query." },
            bank: { type: "string", description: "Memory bank to search.", enum: ["agent-self", "project-kb"], default: "agent-self" },
            max_tokens: { type: "number", description: "Maximum tokens to return (default: 2048)." },
          },
          required: ["query"],
        },
        async execute(args) {
          if (!available) return "Hindsight server is not running.";
          const bank = args.bank || AGENT_BANK;
          const result = await recall(bank, args.query, args.max_tokens);
          if (!result?.results?.length) return `No memories found for "${args.query}" in ${bank}.`;
          return result.results.map((m, i) => {
            const c = m.content || m.text || JSON.stringify(m);
            const t = m.tags ? ` [${m.tags.join(", ")}]` : "";
            return `${i + 1}. ${c}${t}`;
          }).join("\n\n");
        },
      },

      hindsight_reflect: {
        description: "Generate a thoughtful answer by synthesizing stored memories. Use when reasoning about past decisions, patterns, or user preferences rather than just retrieving facts.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "The question or topic to reflect on." },
            bank: { type: "string", description: "Memory bank to reflect on.", enum: ["agent-self", "project-kb"], default: "agent-self" },
          },
          required: ["query"],
        },
        async execute(args) {
          if (!available) return "Hindsight server is not running.";
          const bank = args.bank || AGENT_BANK;
          const result = await reflect(bank, args.query);
          return result.response || result.answer || JSON.stringify(result);
        },
      },
    },
  };
};
