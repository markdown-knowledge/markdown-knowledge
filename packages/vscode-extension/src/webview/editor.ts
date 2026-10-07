/**
 * Dedicated Editor module providing rich inline editing, line numbers gutter,
 * keyboard shortcuts (Ctrl+S, Tab indent), quick markdown toolbar, and status bar.
 */

export function getEditorStyles(): string {
  return `
    /* ==========================================================================
       EDITOR PANE & MONOSPACE CANVAS
       ========================================================================== */
    .editor-pane {
      flex: 1;
      height: 100%;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: var(--vscode-editor-background, #1e1e1e);
    }

    /* Markdown Quick Action Toolbar */
    .editor-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 14px;
      background: var(--vscode-editorGroupHeader-tabsBackground, #252526);
      border-bottom: 1px solid var(--vscode-panel-border, rgba(255, 255, 255, 0.08));
      user-select: none;
      gap: 8px;
    }

    .editor-toolbar-group {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .toolbar-tool-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 24px;
      border-radius: 3px;
      background: transparent;
      border: 1px solid transparent;
      color: var(--vscode-foreground, #ccc);
      cursor: pointer;
      font-size: 11px;
      font-weight: 600;
      transition: background 0.15s, border-color 0.15s;
    }

    .toolbar-tool-btn:hover {
      background: var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.3));
      border-color: var(--vscode-toolbar-hoverOutline, transparent);
      color: var(--vscode-foreground, #fff);
    }

    .toolbar-separator {
      width: 1px;
      height: 16px;
      background: var(--vscode-panel-border, rgba(255, 255, 255, 0.15));
      margin: 0 4px;
    }

    /* Editor Body: Line Number Gutter + Textarea */
    .editor-canvas-container {
      flex: 1;
      display: flex;
      overflow: hidden;
      position: relative;
    }

    .editor-gutter {
      width: 48px;
      min-width: 48px;
      background: var(--vscode-editorGutter-background, #1e1e1e);
      border-right: 1px solid var(--vscode-panel-border, rgba(255, 255, 255, 0.06));
      color: var(--vscode-editorLineNumber-foreground, #858585);
      font-family: var(--vscode-editor-font-family, Consolas, "SFMono-Regular", Menlo, Monaco, monospace);
      font-size: 13px;
      line-height: 1.6;
      text-align: right;
      padding: 16px 8px 16px 0;
      user-select: none;
      overflow: hidden;
    }

    .editor-line-no {
      height: 20.8px; /* sync with line-height 1.6 * 13px */
      display: block;
    }

    .editor-textarea-wrapper {
      flex: 1;
      height: 100%;
      position: relative;
      overflow: hidden;
    }

    .editor-textarea {
      width: 100%;
      height: 100%;
      padding: 16px 20px;
      margin: 0;
      border: none;
      outline: none;
      resize: none;
      background: transparent;
      color: var(--vscode-editor-foreground, #d4d4d4);
      font-family: var(--vscode-editor-font-family, Consolas, "SFMono-Regular", Menlo, Monaco, monospace);
      font-size: 13px;
      line-height: 1.6;
      tab-size: 2;
      white-space: pre;
      overflow: auto;
      caret-color: var(--vscode-editorCursor-foreground, #aeafad);
    }

    .editor-textarea.wrap-lines {
      white-space: pre-wrap;
      word-break: break-word;
    }

    /* Editor Status Bar */
    .editor-statusbar {
      height: 24px;
      min-height: 24px;
      background: var(--vscode-statusBar-background, #007acc);
      color: var(--vscode-statusBar-foreground, #ffffff);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 12px;
      font-size: 11px;
      user-select: none;
    }

    .editor-statusbar-left,
    .editor-statusbar-right {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .dirty-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-weight: 500;
    }

    .dirty-pill.is-dirty {
      color: #ffd166;
    }

    .dirty-pill.is-saved {
      color: #06d6a0;
    }

    .status-item {
      opacity: 0.9;
    }
  `;
}

export function getEditorToolbarHtml(): string {
  return `
    <div class="editor-toolbar">
      <div class="editor-toolbar-group">
        <button class="toolbar-tool-btn" onclick="formatDoc('bold')" title="Bold (Ctrl+B)"><b>B</b></button>
        <button class="toolbar-tool-btn" onclick="formatDoc('italic')" title="Italic (Ctrl+I)"><i>I</i></button>
        <button class="toolbar-tool-btn" onclick="formatDoc('code')" title="Inline Code"><code>&lt;&gt;</code></button>
        <div class="toolbar-separator"></div>
        <button class="toolbar-tool-btn" onclick="formatDoc('h1')" title="Heading 1">H1</button>
        <button class="toolbar-tool-btn" onclick="formatDoc('h2')" title="Heading 2">H2</button>
        <button class="toolbar-tool-btn" onclick="formatDoc('h3')" title="Heading 3">H3</button>
        <div class="toolbar-separator"></div>
        <button class="toolbar-tool-btn" onclick="formatDoc('list')" title="Bulleted List">•-</button>
        <button class="toolbar-tool-btn" onclick="formatDoc('task')" title="Task Checkbox">[✓]</button>
        <button class="toolbar-tool-btn" onclick="formatDoc('quote')" title="Blockquote">”</button>
        <button class="toolbar-tool-btn" onclick="formatDoc('codeblock')" title="Code Fence">{&nbsp;}</button>
        <button class="toolbar-tool-btn" onclick="formatDoc('table')" title="Insert Table">▦</button>
      </div>

      <div class="editor-toolbar-group">
        <button class="toolbar-tool-btn" onclick="toggleWordWrap()" id="btnWordWrap" title="Toggle Word Wrap" style="width: auto; padding: 0 6px; font-size: 10px;">Wrap</button>
      </div>
    </div>
  `;
}

export function getEditorScript(): string {
  return `
    let isDocDirty = false;
    let initialDocContent = "";

    function setupEditorListeners() {
      const textarea = document.getElementById("editorTextarea");
      const gutter = document.getElementById("editorGutter");
      if (!textarea || !gutter) return;

      // Sync scroll with line number gutter
      textarea.addEventListener("scroll", () => {
        gutter.scrollTop = textarea.scrollTop;
      });

      // Update line numbers and stats on input
      textarea.addEventListener("input", () => {
        updateEditorMetrics();
        checkDirtyState();
        if (currentViewMode === "split") {
          liveSplitRender();
        }
      });

      // Keyboard shortcuts
      textarea.addEventListener("keydown", (e) => {
        // Ctrl+S / Cmd+S save
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          saveCurrentDocument();
          return;
        }

        // Ctrl+B bold
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
          e.preventDefault();
          formatDoc("bold");
          return;
        }

        // Ctrl+I italic
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "i") {
          e.preventDefault();
          formatDoc("italic");
          return;
        }

        // Tab indentation (2 spaces)
        if (e.key === "Tab") {
          e.preventDefault();
          const start = textarea.selectionStart;
          const end = textarea.selectionEnd;

          if (!e.shiftKey) {
            // Indent
            textarea.setRangeText("  ", start, end, "end");
          } else {
            // Unindent (remove 2 spaces if present before cursor/line)
            const val = textarea.value;
            const lineStart = val.lastIndexOf("\\n", start - 1) + 1;
            if (val.slice(lineStart, lineStart + 2) === "  ") {
              textarea.setRangeText("", lineStart, lineStart + 2, "preserve");
            }
          }
          updateEditorMetrics();
          checkDirtyState();
          return;
        }

        // Auto-close brackets/quotes
        const bt = String.fromCharCode(96);
        const pairs = { '(': ')', '[': ']', '{': '}', [bt]: bt, '"': '"', "'": "'" };
        if (pairs[e.key]) {
          const start = textarea.selectionStart;
          const end = textarea.selectionEnd;
          if (start === end) {
            e.preventDefault();
            const closeChar = pairs[e.key];
            textarea.setRangeText(e.key + closeChar, start, end, "preserve");
            textarea.selectionStart = start + 1;
            textarea.selectionEnd = start + 1;
            updateEditorMetrics();
            checkDirtyState();
          }
        }
      });
    }

    function updateEditorMetrics() {
      const textarea = document.getElementById("editorTextarea");
      const gutter = document.getElementById("editorGutter");
      if (!textarea || !gutter) return;

      const lines = textarea.value.split("\\n");
      const lineCount = lines.length;

      // Render line numbers in gutter
      let gutterHtml = "";
      for (let i = 1; i <= lineCount; i++) {
        gutterHtml += '<span class="editor-line-no">' + i + '</span>';
      }
      gutter.innerHTML = gutterHtml;

      // Update status stats
      const charCount = textarea.value.length;
      const wordCount = textarea.value.trim() ? textarea.value.trim().split(/\\s+/).length : 0;
      const estimatedTokens = Math.ceil(charCount / 4);

      const statusStats = document.getElementById("statusStats");
      if (statusStats) {
        statusStats.innerText = lineCount + " lines, " + wordCount + " words, ~" + estimatedTokens + " tokens";
      }
    }

    function checkDirtyState() {
      const textarea = document.getElementById("editorTextarea");
      const dirtyIndicator = document.getElementById("dirtyIndicator");
      const saveBtn = document.getElementById("btnSave");
      if (!textarea || !dirtyIndicator) return;

      isDocDirty = textarea.value !== initialDocContent;
      if (isDocDirty) {
        dirtyIndicator.className = "dirty-pill is-dirty";
        dirtyIndicator.innerHTML = "● Unsaved changes";
        if (saveBtn) saveBtn.style.opacity = "1";
      } else {
        dirtyIndicator.className = "dirty-pill is-saved";
        dirtyIndicator.innerHTML = "✓ Saved";
      }
    }

    function formatDoc(action) {
      const textarea = document.getElementById("editorTextarea");
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selected = textarea.value.substring(start, end);

      let replacement = "";
      let newCursorPos = start;

      switch (action) {
        case "bold":
          replacement = "**" + (selected || "bold text") + "**";
          newCursorPos = start + 2;
          break;
        case "italic":
          replacement = "*" + (selected || "italic text") + "*";
          newCursorPos = start + 1;
          break;
        case "code":
          replacement = String.fromCharCode(96) + (selected || "code") + String.fromCharCode(96);
          newCursorPos = start + 1;
          break;
        case "h1":
          replacement = "\\n# " + (selected || "Heading 1") + "\\n";
          newCursorPos = start + 3;
          break;
        case "h2":
          replacement = "\\n## " + (selected || "Heading 2") + "\\n";
          newCursorPos = start + 4;
          break;
        case "h3":
          replacement = "\\n### " + (selected || "Heading 3") + "\\n";
          newCursorPos = start + 5;
          break;
        case "list":
          replacement = "\\n- " + (selected || "List item") + "\\n";
          newCursorPos = start + 3;
          break;
        case "task":
          replacement = "\\n- [ ] " + (selected || "Task item") + "\\n";
          newCursorPos = start + 7;
          break;
        case "quote":
          replacement = "\\n> " + (selected || "Quote text") + "\\n";
          newCursorPos = start + 3;
          break;
        case "codeblock": {
          const bt3 = String.fromCharCode(96, 96, 96);
          replacement = "\\n" + bt3 + "typescript\\n" + (selected || "// code here") + "\\n" + bt3 + "\\n";
          newCursorPos = start + 15;
          break;
        }
        case "table":
          replacement = "\\n| Header 1 | Header 2 |\\n| -------- | -------- |\\n| Value 1  | Value 2  |\\n";
          newCursorPos = start + 1;
          break;
      }

      textarea.setRangeText(replacement, start, end, "select");
      textarea.focus();
      updateEditorMetrics();
      checkDirtyState();
      if (currentViewMode === "split") {
        liveSplitRender();
      }
    }

    let isWordWrap = false;
    function toggleWordWrap() {
      const textarea = document.getElementById("editorTextarea");
      const btn = document.getElementById("btnWordWrap");
      if (!textarea) return;
      isWordWrap = !isWordWrap;
      textarea.classList.toggle("wrap-lines", isWordWrap);
      if (btn) {
        btn.style.color = isWordWrap ? "var(--vscode-button-background)" : "inherit";
      }
    }

    function liveSplitRender() {
      const textarea = document.getElementById("editorTextarea");
      const previewArea = document.getElementById("previewMarkdownBody");
      if (!textarea || !previewArea) return;

      // Request live render from extension if needed, or simple update
      vscode.postMessage({
        type: "requestPreviewRender",
        raw: textarea.value
      });
    }
  `;
}
