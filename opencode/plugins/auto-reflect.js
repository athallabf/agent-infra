/**
 * Auto-Reflection Plugin v2
 *
 * Writes rich session summaries to Obsidian with code diffs,
 * error context, and decision rationale.
 */

const VAULT = "AI-Base";
const SESSIONS_PATH = "Sessions";

const getDate = () => new Date().toISOString().split("T")[0];
const getTime = () => new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

function extractDecisions(messages) {
  const decisions = [];
  messages.filter(m => m.role === "assistant").slice(-8).forEach(msg => {
    const c = msg.content || "";
    [
      /chose (.*?) because/i,
      /decided to (.*?) (?:since|because|as)/i,
      /instead of (.*?), (?:I |we )?(chose|went with|used)/i,
      /best approach: (.*)/i,
      /recommend(?:ation)?: (.*)/i,
      /going with (.*) (?:since|because|as)/i,
    ].forEach(p => {
      const m = c.match(p);
      if (m) decisions.push(m[0].slice(0, 200));
    });
  });
  return [...new Set(decisions)].slice(0, 5);
}

function extractCodeSnippets(tools) {
  const snippets = [];
  tools.filter(t => (t.name || t.tool) === "write" || (t.name || t.tool) === "edit").slice(-5).forEach(t => {
    const file = t.args?.filePath || t.args?.path || "";
    const result = t.result || t.output || "";
    if (file && result && result.length > 20 && result.length < 3000) {
      const ext = file.split(".").pop() || "";
      snippets.push({ file, code: result.slice(0, 1500), lang: ext });
    }
  });
  return snippets;
}

function extractDiffContext(tools) {
  const diffs = [];
  tools.filter(t => (t.name || t.tool) === "edit").slice(-5).forEach(t => {
    const file = t.args?.filePath || t.args?.path || "";
    const oldStr = t.args?.oldString || "";
    const newStr = t.args?.newString || "";
    if (file && oldStr && newStr) {
      diffs.push({
        file,
        old: oldStr.slice(0, 500),
        new: newStr.slice(0, 500),
      });
    }
  });
  return diffs;
}

function extractErrors(tools) {
  return tools.filter(t => t.error).slice(-5).map(e => ({
    tool: e.name || e.tool || "unknown",
    message: (e.error?.message || e.error || "unknown").slice(0, 300),
    args: JSON.stringify(e.args || {}).slice(0, 200),
  }));
}

function buildSummary(session) {
  const messages = session.messages || [];
  const tools = session.tools || [];
  const userMsg = messages.filter(m => m.role === "user").slice(-1)[0]?.content || "N/A";
  const errors = extractErrors(tools);
  const decisions = extractDecisions(messages);
  const diffs = extractDiffContext(tools);
  const snippets = extractCodeSnippets(tools);

  const filesTouched = new Set();
  tools.forEach(t => {
    const p = t.args?.filePath || t.args?.path || t.args?.file;
    if (p) filesTouched.add(p);
  });

  const lines = [
    `# Session ${getDate()} ${getTime()}`,
    "",
    `## Task`,
    userMsg.slice(0, 500),
    "",
    `## Stats`,
    `- Tools: ${tools.length} | Errors: ${errors.length} | Files: ${filesTouched.size}`,
  ];

  if (decisions.length) {
    lines.push("", "## Decisions", ...decisions.map(d => `- ${d}`));
  }

  if (errors.length) {
    lines.push("", "## Errors", ...errors.map(e => `- **${e.tool}**: ${e.message}`));
  }

  if (diffs.length) {
    lines.push("", "## Changes");
    diffs.forEach(d => {
      lines.push(`### ${d.file}`, "```diff", `- ${d.old.slice(0, 200)}`, `+ ${d.new.slice(0, 200)}`, "```", "");
    });
  }

  if (snippets.length) {
    lines.push("", "## New Code");
    snippets.forEach(s => {
      lines.push(`### ${s.file}`, `\`\`\`${s.lang}`, s.code, "```", "");
    });
  }

  if (filesTouched.size) {
    lines.push("", "## Files", ...Array.from(filesTouched).slice(0, 15).map(f => `- ${f}`));
  }

  lines.push("", "---", "");
  return lines.join("\n");
}

export const AutoReflect = async ({ client, $ }) => {
  const logSession = async (session) => {
    try {
      const date = getDate();
      const content = buildSummary(session);
      const notePath = `${SESSIONS_PATH}/${date}.md`;

      const existing = await $`obsidian vault="${VAULT}" read path="${notePath}" 2>/dev/null || echo "NOT_FOUND"`;
      const exists = !existing.toString().includes("NOT_FOUND");

      if (!exists) {
        await $`obsidian vault="${VAULT}" create path="${notePath}" content="# Daily Session Log: ${date}\n\n---\n${content}\n---\n"`;
      } else {
        await $`obsidian vault="${VAULT}" append path="${notePath}" content="\n---\n${content}\n---"`;
      }

      const idx = await $`obsidian vault="${VAULT}" read path="AI-Log-Index.md" 2>/dev/null`;
      if (idx && !idx.toString().includes(notePath)) {
        await $`obsidian vault="${VAULT}" append path="AI-Log-Index.md" content="- [[${notePath}]]\n"`;
      }
    } catch (err) {
      console.error("[Auto-Reflect]", err.message);
    }
  };

  return {
    "session.idle": async ({ session }) => { await logSession(session); },
    "session.compacted": async ({ session }) => { await logSession(session); },
  };
};
