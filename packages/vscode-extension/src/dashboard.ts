import * as vscode from "vscode";
import * as path from "path";
import MarkdownIt from "markdown-it";
import { ContainerStore } from "./store";
import { toMdkUri } from "./fsProvider";

const mdRenderer = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
});

export class MdkDashboardProvider implements vscode.CustomReadonlyEditorProvider {
  constructor(private context: vscode.ExtensionContext, private store: ContainerStore) {}

  async openCustomDocument(uri: vscode.Uri): Promise<vscode.CustomDocument> {
    return { uri, dispose: () => {} };
  }

  async resolveCustomEditor(document: vscode.CustomDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
    const containerFsPath = document.uri.fsPath;
    webviewPanel.webview.options = {
      enableScripts: true,
    };

    let activeDocPath: string | null = null;

    const sendDocData = async (docPath: string) => {
      try {
        const container = await this.store.get(containerFsPath);
        if (container.hasDocument(docPath)) {
          activeDocPath = docPath;
          const raw = container.readDocument(docPath);
          const docInfo = container.getDocument(docPath);
          const rendered = mdRenderer.render(raw);
          webviewPanel.webview.postMessage({
            type: "docLoaded",
            doc: {
              path: docInfo.path,
              title: docInfo.title,
              tags: docInfo.tags,
              size: docInfo.size,
              updatedAt: docInfo.updatedAt,
              raw,
              rendered,
            },
          });
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to read document: ${err.message}`);
      }
    };

    const updateWebview = async () => {
      try {
        const container = await this.store.get(containerFsPath);
        const docs = container.listDocuments();
        const index = await container.getIndex();
        const status = index.status();

        if (!activeDocPath && docs.length > 0) {
          activeDocPath = docs[0].path;
        }

        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview, {
          title: container.manifest.title || path.basename(containerFsPath),
          filePath: containerFsPath,
          docCount: docs.length,
          indexStatus: status,
          hasPersistedIndex: container.hasPersistedIndex,
          documents: docs,
          activeDocPath,
        });

        if (activeDocPath) {
          await sendDocData(activeDocPath);
        }
      } catch (err) {
        webviewPanel.webview.html = `<h3>Error loading container: ${err}</h3>`;
      }
    };

    const changeSub = this.store.onDidChange((changedPath) => {
      if (this.store.normalizePath(changedPath) === this.store.normalizePath(containerFsPath)) {
        updateWebview();
      }
    });
    webviewPanel.onDidDispose(() => changeSub.dispose());

    webviewPanel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case "selectDoc": {
          await sendDocData(msg.docPath);
          break;
        }
        case "openInTab": {
          const docUri = toMdkUri(containerFsPath, msg.docPath);
          await vscode.commands.executeCommand("vscode.open", docUri);
          break;
        }
        case "saveDoc": {
          try {
            const container = await this.store.get(containerFsPath);
            container.writeDocument(msg.docPath, msg.content);
            const idx = await container.getIndex();
            idx.update({ paths: [msg.docPath] });
            await this.store.saveImmediately(containerFsPath);
            await sendDocData(msg.docPath);
            vscode.window.showInformationMessage(`Saved ${path.basename(msg.docPath)}`);
          } catch (e: any) {
            vscode.window.showErrorMessage(`Save failed: ${e.message}`);
          }
          break;
        }
        case "addDoc": {
          await vscode.commands.executeCommand("mdk.addDocument", { containerFsPath });
          break;
        }
        case "importFolder": {
          await vscode.commands.executeCommand("mdk.importFolder", { containerFsPath });
          break;
        }
        case "rebuildIndex": {
          await vscode.commands.executeCommand("mdk.rebuildIndex", { containerFsPath });
          break;
        }
        case "search": {
          try {
            const container = await this.store.get(containerFsPath);
            const index = await container.getIndex();
            const hits = index.search(msg.query, { limit: 20 });
            webviewPanel.webview.postMessage({
              type: "searchResults",
              hits,
            });
          } catch (e: any) {
            webviewPanel.webview.postMessage({
              type: "searchError",
              message: e.message,
            });
          }
          break;
        }
      }
    });

    await updateWebview();
  }

  private getHtmlForWebview(webview: vscode.Webview, data: any): string {
    const isFresh = data.indexStatus.fresh && data.hasPersistedIndex;
    const indexDotColor = isFresh ? "var(--vscode-testing-iconPassed, #4ec9b0)" : "var(--vscode-testing-iconQueued, #cca700)";
    const indexStatusText = isFresh
      ? `Index: Fresh (${data.indexStatus.chunks} chunks)`
      : !data.hasPersistedIndex
      ? `Index: Unbuilt`
      : `Index: Stale (${data.indexStatus.stale.length} changed)`;

    const docsJson = JSON.stringify(data.documents);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(data.title)}</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      color: var(--vscode-editor-foreground);
      background-color: var(--vscode-editor-background);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      font-size: 13px;
    }

    /* 1. TOP HEADER (28px) */
    .top-header {
      height: 32px;
      min-height: 32px;
      background: var(--vscode-editorGroupHeader-tabsBackground, #1e1e1e);
      border-bottom: 1px solid var(--vscode-panel-border, #2d2d2d);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 12px;
      user-select: none;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .container-title {
      font-weight: 600;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .doc-count-badge {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #888);
      background: var(--vscode-badge-background, #3a3d41);
      color: var(--vscode-badge-foreground, #fff);
      padding: 1px 6px;
      border-radius: 10px;
    }
    .index-indicator {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #999);
      margin-left: 6px;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background-color: ${indexDotColor};
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    button.btn-header {
      background: transparent;
      color: var(--vscode-foreground, #ccc);
      border: 1px solid transparent;
      border-radius: 3px;
      padding: 3px 8px;
      font-size: 11px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    button.btn-header:hover {
      background: var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.31));
      border-color: var(--vscode-toolbar-hoverOutline, transparent);
    }
    button.btn-primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    button.btn-primary:hover {
      background: var(--vscode-button-hoverBackground);
    }

    /* 2. MAIN WORKSPACE (SPLIT PANE) */
    .workspace {
      flex: 1;
      display: flex;
      overflow: hidden;
    }

    /* LEFT SIDEBAR: Document List & Search */
    .sidebar {
      width: 270px;
      min-width: 200px;
      max-width: 450px;
      background: var(--vscode-sideBar-background, #252526);
      border-right: 1px solid var(--vscode-panel-border, #2d2d2d);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .search-container {
      padding: 8px;
      border-bottom: 1px solid var(--vscode-panel-border, #2d2d2d);
    }
    .search-input {
      width: 100%;
      padding: 6px 8px;
      font-size: 12px;
      border-radius: 3px;
      border: 1px solid var(--vscode-input-border, #3c3c3c);
      background: var(--vscode-input-background, #1e1e1e);
      color: var(--vscode-input-foreground, #fff);
      outline: none;
    }
    .search-input:focus {
      border-color: var(--vscode-focusBorder, #007fd4);
    }
    .sidebar-list {
      flex: 1;
      overflow-y: auto;
      list-style: none;
    }
    .doc-item {
      padding: 7px 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .doc-item:hover {
      background: var(--vscode-list-hoverBackground, rgba(90, 93, 94, 0.15));
    }
    .doc-item.active {
      background: var(--vscode-list-activeSelectionBackground, #094771);
      color: var(--vscode-list-activeSelectionForeground, #fff);
    }
    .doc-item-title {
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .doc-item-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 10px;
      color: var(--vscode-descriptionForeground, #888);
    }
    .doc-item.active .doc-item-meta {
      color: rgba(255, 255, 255, 0.7);
    }
    .tag-badge {
      font-size: 9px;
      padding: 0 4px;
      border-radius: 2px;
      background: rgba(255, 255, 255, 0.08);
    }

    /* RIGHT DETAIL: Rendered Viewer & Editor */
    .detail-pane {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: var(--vscode-editor-background, #1e1e1e);
    }
    .detail-toolbar {
      height: 36px;
      min-height: 36px;
      border-bottom: 1px solid var(--vscode-panel-border, #2d2d2d);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      background: var(--vscode-editor-background, #1e1e1e);
    }
    .detail-doc-info {
      display: flex;
      align-items: center;
      gap: 10px;
      overflow: hidden;
    }
    .detail-doc-title {
      font-weight: 600;
      font-size: 13px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .detail-doc-path {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #888);
      font-family: var(--vscode-editor-font-family, monospace);
    }
    .detail-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .view-mode-toggle {
      display: inline-flex;
      border: 1px solid var(--vscode-panel-border, #3c3c3c);
      border-radius: 3px;
      overflow: hidden;
    }
    .toggle-btn {
      background: transparent;
      color: var(--vscode-foreground, #ccc);
      border: none;
      padding: 3px 10px;
      font-size: 11px;
      cursor: pointer;
    }
    .toggle-btn.active {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    button.btn-tab-open {
      background: var(--vscode-button-secondaryBackground, #3a3d41);
      color: var(--vscode-button-secondaryForeground, #fff);
      border: none;
      border-radius: 3px;
      padding: 4px 10px;
      font-size: 11px;
      cursor: pointer;
    }
    button.btn-tab-open:hover {
      background: var(--vscode-button-secondaryHoverBackground, #45494e);
    }
    button.btn-save {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 3px;
      padding: 4px 10px;
      font-size: 11px;
      cursor: pointer;
    }

    /* Content Area */
    .content-area {
      flex: 1;
      overflow-y: auto;
      padding: 24px 32px;
      position: relative;
    }

    /* Rendered Markdown Typography */
    .markdown-body {
      max-width: 860px;
      margin: 0 auto;
      line-height: 1.6;
      color: var(--vscode-editor-foreground);
    }
    .markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4 {
      margin-top: 24px;
      margin-bottom: 12px;
      font-weight: 600;
      line-height: 1.25;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      padding-bottom: 6px;
    }
    .markdown-body h1 { font-size: 24px; margin-top: 0; }
    .markdown-body h2 { font-size: 18px; }
    .markdown-body h3 { font-size: 15px; border-bottom: none; }
    .markdown-body p, .markdown-body ul, .markdown-body ol {
      margin-bottom: 16px;
    }
    .markdown-body ul, .markdown-body ol {
      padding-left: 24px;
    }
    .markdown-body li {
      margin-bottom: 4px;
    }
    .markdown-body code {
      font-family: var(--vscode-editor-font-family, Consolas, 'Courier New', monospace);
      font-size: 12px;
      background: rgba(255, 255, 255, 0.06);
      padding: 2px 5px;
      border-radius: 3px;
    }
    .markdown-body pre {
      background: var(--vscode-editorWidget-background, #141414);
      border: 1px solid var(--vscode-widget-border, #2d2d2d);
      border-radius: 5px;
      padding: 12px 16px;
      overflow-x: auto;
      margin-bottom: 16px;
    }
    .markdown-body pre code {
      background: transparent;
      padding: 0;
    }
    .markdown-body blockquote {
      border-left: 4px solid var(--vscode-focusBorder, #007fd4);
      padding-left: 12px;
      color: var(--vscode-descriptionForeground, #999);
      margin-bottom: 16px;
    }
    .markdown-body table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
    }
    .markdown-body th, .markdown-body td {
      border: 1px solid var(--vscode-panel-border, #333);
      padding: 6px 12px;
      text-align: left;
    }
    .markdown-body th {
      background: rgba(255, 255, 255, 0.04);
    }

    /* Raw Markdown Editor View */
    .editor-textarea {
      width: 100%;
      height: 100%;
      border: none;
      outline: none;
      resize: none;
      background: transparent;
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-editor-font-family, Consolas, 'Courier New', monospace);
      font-size: 13px;
      line-height: 1.5;
    }

    /* Search Results Highlight */
    .search-hit-snippet {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #aaa);
      margin-top: 3px;
      line-height: 1.3;
    }
    .search-hit-snippet mark {
      background: var(--vscode-editor-findMatchHighlightBackground, #ea5c0066);
      color: inherit;
      border-radius: 2px;
      padding: 0 2px;
    }
    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--vscode-descriptionForeground, #888);
      font-size: 13px;
    }
  </style>
</head>
<body>

  <!-- 1. TOP HEADER (STATUS & ACTIONS) -->
  <header class="top-header">
    <div class="header-left">
      <span class="container-title">
        📦 ${escapeHtml(data.title)}
      </span>
      <span class="doc-count-badge">${data.docCount} docs</span>
      <span class="index-indicator" title="${data.filePath}">
        <span class="status-dot"></span>
        <span>${indexStatusText}</span>
      </span>
    </div>
    <div class="header-actions">
      <button class="btn-header btn-primary" onclick="vscode.postMessage({ type: 'addDoc' })" title="Add Document">+ New Document</button>
      <button class="btn-header" onclick="vscode.postMessage({ type: 'rebuildIndex' })" title="Rebuild SQLite Search Index">⚡ Reindex</button>
      <button class="btn-header" onclick="vscode.postMessage({ type: 'importFolder' })" title="Import Folder of Markdown">📥 Import</button>
    </div>
  </header>

  <!-- 2. MAIN WORKSPACE (SPLIT VIEW) -->
  <main class="workspace">

    <!-- LEFT SIDEBAR: DOCUMENTS & LIVE FILTER -->
    <aside class="sidebar">
      <div class="search-container">
        <input 
          type="text" 
          id="filterInput" 
          class="search-input" 
          placeholder="Filter or search content..." 
          oninput="handleSearch(this.value)" 
        />
      </div>
      <ul id="docList" class="sidebar-list">
        <!-- populated by JS -->
      </ul>
    </aside>

    <!-- RIGHT DETAIL: VIEWER & EDITOR -->
    <section class="detail-pane">
      <div class="detail-toolbar">
        <div class="detail-doc-info">
          <span id="activeDocTitle" class="detail-doc-title">Select a document</span>
          <span id="activeDocPath" class="detail-doc-path"></span>
        </div>
        <div class="detail-actions">
          <div class="view-mode-toggle">
            <button id="btnModePreview" class="toggle-btn active" onclick="setMode('preview')">Preview</button>
            <button id="btnModeEdit" class="toggle-btn" onclick="setMode('edit')">Edit</button>
          </div>
          <button id="btnSave" class="btn-save" style="display: none;" onclick="saveCurrentDoc()">Save</button>
          <button class="btn-tab-open" onclick="openActiveInTab()" title="Open in VS Code Editor Tab">Open in Editor Tab ↗</button>
        </div>
      </div>

      <div class="content-area">
        <div id="previewContainer" class="markdown-body">
          <div class="empty-state">Select a document from the left to read or edit.</div>
        </div>
        <textarea id="editorTextarea" class="editor-textarea" style="display: none;" placeholder="Write markdown here..."></textarea>
      </div>
    </section>

  </main>

  <script>
    const vscode = acquireVsCodeApi();
    const allDocs = ${docsJson};
    let currentDoc = null;
    let viewMode = 'preview'; // 'preview' | 'edit'
    let searchTimeout = null;

    function renderDocList(docs, isSearchResult = false) {
      const listEl = document.getElementById('docList');
      if (!docs.length) {
        listEl.innerHTML = '<li style="padding: 16px; color: var(--vscode-descriptionForeground); text-align: center;">No documents match.</li>';
        return;
      }

      listEl.innerHTML = docs.map(d => {
        const isActive = currentDoc && currentDoc.path === d.path;
        const tagBadges = (d.tags || []).map(t => '<span class="tag-badge">' + escapeHtml(t) + '</span>').join(' ');
        
        let snippetHtml = '';
        if (isSearchResult && d.snippet) {
          const clean = d.snippet
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/«/g, '<mark>').replace(/»/g, '</mark>');
          snippetHtml = '<div class="search-hit-snippet">' + clean + '</div>';
        }

        return \`
          <li class="doc-item \${isActive ? 'active' : ''}" onclick="selectDoc('\${d.path}')">
            <div class="doc-item-title">\${escapeHtml(d.title || d.path)}</div>
            <div class="doc-item-meta">
              <span>\${escapeHtml(d.path)}</span>
              <span>\${tagBadges}</span>
            </div>
            \${snippetHtml}
          </li>
        \`;
      }).join('');
    }

    function selectDoc(docPath) {
      vscode.postMessage({ type: 'selectDoc', docPath });
    }

    function setMode(mode) {
      viewMode = mode;
      const previewEl = document.getElementById('previewContainer');
      const editorEl = document.getElementById('editorTextarea');
      const btnPreview = document.getElementById('btnModePreview');
      const btnEdit = document.getElementById('btnModeEdit');
      const btnSave = document.getElementById('btnSave');

      if (mode === 'preview') {
        btnPreview.classList.add('active');
        btnEdit.classList.remove('active');
        previewEl.style.display = 'block';
        editorEl.style.display = 'none';
        btnSave.style.display = 'none';
      } else {
        btnEdit.classList.add('active');
        btnPreview.classList.remove('active');
        previewEl.style.display = 'none';
        editorEl.style.display = 'block';
        btnSave.style.display = 'inline-block';
        editorEl.focus();
      }
    }

    function saveCurrentDoc() {
      if (!currentDoc) return;
      const content = document.getElementById('editorTextarea').value;
      vscode.postMessage({
        type: 'saveDoc',
        docPath: currentDoc.path,
        content
      });
    }

    function openActiveInTab() {
      if (currentDoc) {
        vscode.postMessage({ type: 'openInTab', docPath: currentDoc.path });
      }
    }

    function handleSearch(val) {
      clearTimeout(searchTimeout);
      const q = val.trim();
      if (!q) {
        renderDocList(allDocs);
        return;
      }

      // If query is small, do instant path/title filtering locally
      const localMatches = allDocs.filter(d => 
        d.path.toLowerCase().includes(q.toLowerCase()) || 
        (d.title && d.title.toLowerCase().includes(q.toLowerCase())) ||
        (d.tags && d.tags.some(t => t.toLowerCase().includes(q.toLowerCase())))
      );
      renderDocList(localMatches);

      // Also trigger FTS backend search for full-text content matches
      searchTimeout = setTimeout(() => {
        vscode.postMessage({ type: 'search', query: q });
      }, 300);
    }

    // Keyboard shortcut: Ctrl+S / Cmd+S in editor saves the doc
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (viewMode === 'edit') {
          saveCurrentDoc();
        }
      }
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'docLoaded') {
        currentDoc = msg.doc;
        document.getElementById('activeDocTitle').textContent = currentDoc.title || currentDoc.path;
        document.getElementById('activeDocPath').textContent = currentDoc.path;
        document.getElementById('previewContainer').innerHTML = currentDoc.rendered;
        document.getElementById('editorTextarea').value = currentDoc.raw;
        // update active highlight in sidebar
        const items = document.querySelectorAll('.doc-item');
        items.forEach(el => el.classList.remove('active'));
        const activeEl = Array.from(items).find(el => el.textContent.includes(currentDoc.path));
        if (activeEl) activeEl.classList.add('active');
      } else if (msg.type === 'searchResults') {
        const inputVal = document.getElementById('filterInput').value.trim();
        if (inputVal && msg.hits && msg.hits.length) {
          renderDocList(msg.hits, true);
        }
      }
    });

    // Initial render of doc list
    renderDocList(allDocs);
    if (allDocs.length > 0) {
      selectDoc(allDocs[0].path);
    }

    function escapeHtml(str) {
      return (str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }
  </script>
</body>
</html>`;
  }
}

function escapeHtml(str: string): string {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
