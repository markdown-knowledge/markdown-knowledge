import MarkdownIt from "markdown-it";
import matter from "gray-matter";

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
});

// Custom renderer rule for code blocks to add copy button and language tag
const defaultFence = md.renderer.rules.fence || function (tokens, idx, options, env, self) {
  return self.renderToken(tokens, idx, options);
};

md.renderer.rules.fence = function (tokens, idx, options, env, self) {
  const token = tokens[idx];
  const info = token.info ? token.info.trim() : "";
  const lang = info ? info.split(/\s+/)[0] : "text";
  const rawCode = token.content;

  const originalHtml = defaultFence(tokens, idx, options, env, self);

  return `
    <div class="code-block-wrapper">
      <div class="code-block-header">
        <span class="code-lang-tag">${escapeHtml(lang)}</span>
        <button class="btn-copy-code" onclick="copyCode(this)" title="Copy code" data-code="${escapeAttribute(rawCode)}">
          <svg class="copy-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          <span class="copy-text">Copy</span>
        </button>
      </div>
      ${originalHtml}
    </div>
  `;
};

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeAttribute(str: string): string {
  return encodeURIComponent(str);
}

/**
 * Transforms Markdown callouts (> [!NOTE], > [!WARNING], etc.) into styled alert cards
 */
function enhanceCallouts(html: string): string {
  const alertRegex = /<blockquote>\s*<p>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\s*<br\s*\/?>)?([\s\S]*?)<\/p>\s*<\/blockquote>/gi;
  return html.replace(alertRegex, (match, type, content) => {
    const alertType = type.toLowerCase();
    const titles: Record<string, string> = {
      note: "Note",
      tip: "Tip",
      important: "Important",
      warning: "Warning",
      caution: "Caution",
    };
    return `
      <div class="markdown-alert markdown-alert-${alertType}">
        <div class="markdown-alert-title">
          <span class="alert-icon"></span>
          <span>${titles[alertType] || type}</span>
        </div>
        <div class="markdown-alert-content">${content.trim()}</div>
      </div>
    `;
  });
}

/**
 * Parses and renders Markdown content into polished HTML
 */
export function renderMarkdown(raw: string): { html: string; frontmatter: Record<string, any>; cleanBody: string } {
  try {
    const parsed = matter(raw);
    const renderedHtml = md.render(parsed.content);
    const enhanced = enhanceCallouts(renderedHtml);
    return {
      html: enhanced,
      frontmatter: parsed.data || {},
      cleanBody: parsed.content,
    };
  } catch {
    const renderedHtml = md.render(raw);
    return {
      html: enhanceCallouts(renderedHtml),
      frontmatter: {},
      cleanBody: raw,
    };
  }
}

/**
 * Returns CSS styles specific to the Preview pane
 */
export function getPreviewStyles(): string {
  return `
    /* ==========================================================================
       PREVIEW CONTAINER & TYPOGRAPHY
       ========================================================================== */
    .preview-pane {
      flex: 1;
      height: 100%;
      overflow-y: auto;
      padding: 32px 48px;
      scroll-behavior: smooth;
    }

    .markdown-container {
      max-width: 860px;
      margin: 0 auto;
    }

    /* Document Meta Card */
    .doc-meta-card {
      background: var(--vscode-editorWidget-background, rgba(255, 255, 255, 0.03));
      border: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.08));
      border-radius: 8px;
      padding: 14px 18px;
      margin-bottom: 28px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }
    .doc-meta-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .doc-meta-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--vscode-editor-foreground);
    }
    .doc-meta-pills {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      font-size: 11px;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 12px;
      background: var(--vscode-badge-background, rgba(255, 255, 255, 0.08));
      color: var(--vscode-badge-foreground, #ddd);
      font-size: 11px;
    }
    .pill-tag {
      background: rgba(56, 139, 253, 0.15);
      color: #58a6ff;
      border: 1px solid rgba(56, 139, 253, 0.3);
    }
    .pill-path {
      font-family: var(--vscode-editor-font-family, monospace);
      opacity: 0.85;
    }

    /* Markdown Body Typography */
    .markdown-body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
      font-size: 14px;
      line-height: 1.7;
      color: var(--vscode-editor-foreground, #cccccc);
      word-wrap: break-word;
    }

    .markdown-body h1,
    .markdown-body h2,
    .markdown-body h3,
    .markdown-body h4,
    .markdown-body h5,
    .markdown-body h6 {
      margin-top: 28px;
      margin-bottom: 14px;
      font-weight: 600;
      line-height: 1.3;
      color: var(--vscode-editor-foreground, #ffffff);
    }

    .markdown-body h1 {
      font-size: 26px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--vscode-panel-border, rgba(255, 255, 255, 0.12));
      margin-top: 10px;
    }

    .markdown-body h2 {
      font-size: 20px;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--vscode-panel-border, rgba(255, 255, 255, 0.08));
    }

    .markdown-body h3 {
      font-size: 16px;
    }

    .markdown-body h4 {
      font-size: 14px;
    }

    .markdown-body p,
    .markdown-body ul,
    .markdown-body ol {
      margin-bottom: 16px;
    }

    .markdown-body ul,
    .markdown-body ol {
      padding-left: 26px;
    }

    .markdown-body li {
      margin-bottom: 6px;
    }

    .markdown-body li > p {
      margin-bottom: 8px;
    }

    .markdown-body hr {
      height: 1px;
      padding: 0;
      margin: 28px 0;
      background-color: var(--vscode-panel-border, rgba(255, 255, 255, 0.1));
      border: 0;
    }

    /* Inline Code */
    .markdown-body code {
      font-family: var(--vscode-editor-font-family, Consolas, "SFMono-Regular", Menlo, Monaco, monospace);
      font-size: 12.5px;
      padding: 2px 6px;
      margin: 0;
      background: var(--vscode-textCodeBlock-background, rgba(255, 255, 255, 0.07));
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 4px;
      color: var(--vscode-textPreformat-foreground, #f08c00);
    }

    /* Code Block Containers */
    .code-block-wrapper {
      margin: 18px 0;
      border-radius: 8px;
      border: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.1));
      background: var(--vscode-editorWidget-background, #141414);
      overflow: hidden;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .code-block-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 12px;
      background: rgba(255, 255, 255, 0.03);
      border-bottom: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.06));
      font-size: 11px;
    }

    .code-lang-tag {
      font-family: var(--vscode-editor-font-family, monospace);
      font-weight: 500;
      color: var(--vscode-descriptionForeground, #888);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .btn-copy-code {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 4px;
      padding: 2px 7px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #999);
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .btn-copy-code:hover {
      background: rgba(255, 255, 255, 0.08);
      color: var(--vscode-foreground, #fff);
      border-color: rgba(255, 255, 255, 0.12);
    }

    .btn-copy-code.copied {
      color: var(--vscode-testing-iconPassed, #4ec9b0);
    }

    .markdown-body pre {
      margin: 0;
      padding: 14px 16px;
      overflow-x: auto;
      font-family: var(--vscode-editor-font-family, Consolas, "SFMono-Regular", Menlo, Monaco, monospace);
      font-size: 13px;
      line-height: 1.55;
      background: transparent;
    }

    .markdown-body pre code {
      background: transparent;
      border: none;
      padding: 0;
      font-size: inherit;
      color: inherit;
    }

    /* Blockquotes */
    .markdown-body blockquote {
      margin: 18px 0;
      padding: 8px 16px;
      color: var(--vscode-descriptionForeground, #999);
      border-left: 4px solid var(--vscode-focusBorder, #007fd4);
      background: rgba(255, 255, 255, 0.02);
      border-radius: 0 6px 6px 0;
    }

    /* GitHub-style Callout Alerts */
    .markdown-alert {
      margin: 18px 0;
      padding: 12px 16px;
      border-left: 4px solid;
      border-radius: 0 6px 6px 0;
      background: rgba(255, 255, 255, 0.02);
    }
    .markdown-alert-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
      font-size: 13px;
      margin-bottom: 6px;
    }
    .markdown-alert-content {
      font-size: 13px;
      line-height: 1.5;
    }
    .markdown-alert-note {
      border-color: #2f81f7;
      background: rgba(56, 139, 253, 0.06);
    }
    .markdown-alert-note .markdown-alert-title { color: #58a6ff; }
    .markdown-alert-tip {
      border-color: #3fb950;
      background: rgba(63, 185, 80, 0.06);
    }
    .markdown-alert-tip .markdown-alert-title { color: #56d364; }
    .markdown-alert-important {
      border-color: #a371f7;
      background: rgba(163, 113, 247, 0.06);
    }
    .markdown-alert-important .markdown-alert-title { color: #bc8cff; }
    .markdown-alert-warning {
      border-color: #d29922;
      background: rgba(210, 153, 34, 0.06);
    }
    .markdown-alert-warning .markdown-alert-title { color: #e3b341; }
    .markdown-alert-caution {
      border-color: #f85149;
      background: rgba(248, 81, 73, 0.06);
    }
    .markdown-alert-caution .markdown-alert-title { color: #ff7b72; }

    /* Tables */
    .markdown-body table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      overflow-x: auto;
      display: block;
      border: 1px solid var(--vscode-panel-border, rgba(255, 255, 255, 0.1));
      border-radius: 6px;
    }

    .markdown-body th,
    .markdown-body td {
      padding: 9px 14px;
      border: 1px solid var(--vscode-panel-border, rgba(255, 255, 255, 0.08));
      text-align: left;
    }

    .markdown-body th {
      background: var(--vscode-editorWidget-background, rgba(255, 255, 255, 0.04));
      font-weight: 600;
      color: var(--vscode-editor-foreground);
    }

    .markdown-body tr:nth-child(even) {
      background: rgba(255, 255, 255, 0.02);
    }

    /* Links */
    .markdown-body a {
      color: var(--vscode-textLink-foreground, #3794ff);
      text-decoration: none;
      font-weight: 500;
    }

    .markdown-body a:hover {
      text-decoration: underline;
      color: var(--vscode-textLink-activeForeground, #58a6ff);
    }
  `;
}

/**
 * Returns client-side JavaScript for Preview interactivity (copy button, etc.)
 */
export function getPreviewScript(): string {
  return `
    function copyCode(btn) {
      const code = decodeURIComponent(btn.getAttribute("data-code") || "");
      navigator.clipboard.writeText(code).then(() => {
        const textSpan = btn.querySelector(".copy-text");
        const originalText = textSpan.innerText;
        btn.classList.add("copied");
        textSpan.innerText = "Copied!";
        setTimeout(() => {
          btn.classList.remove("copied");
          textSpan.innerText = originalText;
        }, 2000);
      }).catch(err => {
        console.error("Failed to copy code: ", err);
      });
    }
  `;
}
