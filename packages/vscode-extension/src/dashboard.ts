import * as vscode from "vscode";
import * as path from "path";
import { ContainerStore } from "./store";
import { toMdkUri } from "./fsProvider";

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

    const updateWebview = async () => {
      try {
        const container = await this.store.get(containerFsPath);
        const docs = container.listDocuments();
        const index = await container.getIndex();
        const status = index.status();

        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview, {
          title: container.manifest.title || path.basename(containerFsPath),
          description: container.manifest.description || "No description",
          filePath: containerFsPath,
          createdAt: container.manifest.createdAt,
          updatedAt: container.manifest.updatedAt,
          docCount: docs.length,
          totalBytes: docs.reduce((acc, d) => acc + d.size, 0),
          indexStatus: status,
          hasPersistedIndex: container.hasPersistedIndex,
          documents: docs,
        });
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
        case "openDoc": {
          const docUri = toMdkUri(containerFsPath, msg.docPath);
          await vscode.commands.executeCommand("vscode.open", docUri);
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
            const hits = index.search(msg.query, { limit: 15 });
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
    const indexBadge = isFresh
      ? `<span class="badge success">Fresh (${data.indexStatus.chunks} chunks)</span>`
      : !data.hasPersistedIndex
      ? `<span class="badge warning">Not built</span>`
      : `<span class="badge warning">Stale (${data.indexStatus.stale.length} changed)</span>`;

    const docsHtml = data.documents
      .map(
        (d: any) => `
        <tr class="doc-row" onclick="openDoc('${d.path}')">
          <td class="doc-title">
            <span class="codicon codicon-markdown"></span>
            <strong>${escapeHtml(d.title)}</strong>
            <div class="doc-path">${escapeHtml(d.path)}</div>
          </td>
          <td>${d.tags.map((t: string) => `<span class="tag">${escapeHtml(t)}</span>`).join(" ")}</td>
          <td class="text-muted">${formatBytes(d.size)}</td>
          <td class="text-muted">${new Date(d.updatedAt).toLocaleDateString()}</td>
        </tr>
      `
      )
      .join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(data.title)}</title>
  <style>
    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      color: var(--vscode-editor-foreground);
      background-color: var(--vscode-editor-background);
      padding: 24px;
      margin: 0;
      line-height: 1.5;
    }
    .header {
      margin-bottom: 24px;
      border-bottom: 1px solid var(--vscode-panel-border, #333);
      padding-bottom: 16px;
    }
    .title {
      font-size: 24px;
      font-weight: 600;
      margin: 0 0 8px 0;
    }
    .desc {
      color: var(--vscode-descriptionForeground, #888);
      margin: 0 0 12px 0;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .card {
      background: var(--vscode-editorWidget-background, #252526);
      border: 1px solid var(--vscode-widget-border, #3c3c3c);
      border-radius: 6px;
      padding: 16px;
    }
    .card-label {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-descriptionForeground, #888);
    }
    .card-val {
      font-size: 20px;
      font-weight: 600;
      margin-top: 4px;
    }
    .actions {
      display: flex;
      gap: 10px;
      margin-bottom: 24px;
      flex-wrap: wrap;
    }
    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 8px 14px;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 500;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground, #3a3d41);
      color: var(--vscode-button-secondaryForeground, #ffffff);
    }
    button.secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground, #45494e);
    }
    .search-box {
      margin-bottom: 24px;
      background: var(--vscode-editorWidget-background, #252526);
      border: 1px solid var(--vscode-widget-border, #3c3c3c);
      border-radius: 6px;
      padding: 16px;
    }
    .search-input {
      width: 100%;
      box-sizing: border-box;
      padding: 10px 12px;
      border-radius: 4px;
      border: 1px solid var(--vscode-input-border, #3c3c3c);
      background: var(--vscode-input-background, #1e1e1e);
      color: var(--vscode-input-foreground, #fff);
      font-size: 14px;
      outline: none;
    }
    .search-input:focus {
      border-color: var(--vscode-focusBorder, #007fd4);
    }
    .search-results {
      margin-top: 12px;
      max-height: 350px;
      overflow-y: auto;
    }
    .hit-item {
      padding: 10px;
      border-bottom: 1px solid var(--vscode-panel-border, #333);
      cursor: pointer;
      border-radius: 4px;
    }
    .hit-item:hover {
      background: var(--vscode-list-hoverBackground, #2a2d2e);
    }
    .hit-header {
      display: flex;
      justify-content: space-between;
      font-weight: 600;
      font-size: 13px;
    }
    .hit-snippet {
      font-size: 12px;
      color: var(--vscode-descriptionForeground, #aaa);
      margin-top: 4px;
    }
    .hit-snippet mark {
      background: var(--vscode-editor-findMatchHighlightBackground, #ea5c0055);
      color: inherit;
      border-radius: 2px;
      padding: 0 2px;
    }
    .badge {
      display: inline-block;
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 10px;
      font-weight: 500;
    }
    .badge.success {
      background: #19875422;
      color: #75b798;
      border: 1px solid #75b798;
    }
    .badge.warning {
      background: #ffc10722;
      color: #ffda6a;
      border: 1px solid #ffda6a;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 12px;
    }
    th, td {
      text-align: left;
      padding: 10px 12px;
      border-bottom: 1px solid var(--vscode-panel-border, #333);
    }
    th {
      font-size: 12px;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground, #888);
    }
    tr.doc-row {
      cursor: pointer;
    }
    tr.doc-row:hover {
      background: var(--vscode-list-hoverBackground, #2a2d2e);
    }
    .doc-path {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #888);
    }
    .tag {
      background: var(--vscode-badge-background, #4d4d4d);
      color: var(--vscode-badge-foreground, #fff);
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 3px;
    }
    .text-muted {
      color: var(--vscode-descriptionForeground, #888);
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1 class="title">${escapeHtml(data.title)}</h1>
    <p class="desc">${escapeHtml(data.description)}</p>
    <div class="text-muted">${escapeHtml(data.filePath)}</div>
  </div>

  <div class="grid">
    <div class="card">
      <div class="card-label">Documents</div>
      <div class="card-val">${data.docCount}</div>
    </div>
    <div class="card">
      <div class="card-label">Total Size</div>
      <div class="card-val">${formatBytes(data.totalBytes)}</div>
    </div>
    <div class="card">
      <div class="card-label">SQLite Search Index</div>
      <div class="card-val" style="font-size: 14px; margin-top: 8px;">${indexBadge}</div>
    </div>
  </div>

  <div class="actions">
    <button onclick="vscode.postMessage({ type: 'addDoc' })">+ Add Document</button>
    <button class="secondary" onclick="vscode.postMessage({ type: 'importFolder' })">📥 Import Folder</button>
    <button class="secondary" onclick="vscode.postMessage({ type: 'rebuildIndex' })">⚡ Rebuild Index</button>
  </div>

  <div class="search-box">
    <input type="text" id="searchInput" class="search-input" placeholder="Search full-text (BM25 ranked) inside this container..." oninput="handleSearch(this.value)" />
    <div id="searchResults" class="search-results" style="display: none;"></div>
  </div>

  <h2 style="font-size: 16px; margin: 24px 0 8px 0;">All Documents (${data.docCount})</h2>
  <table>
    <thead>
      <tr>
        <th>Document</th>
        <th>Tags</th>
        <th>Size</th>
        <th>Modified</th>
      </tr>
    </thead>
    <tbody>
      ${docsHtml || '<tr><td colspan="4" class="text-muted">No documents yet. Click "Add Document" to create one.</td></tr>'}
    </tbody>
  </table>

  <script>
    const vscode = acquireVsCodeApi();
    let searchTimeout = null;

    function openDoc(path) {
      vscode.postMessage({ type: 'openDoc', docPath: path });
    }

    function handleSearch(query) {
      clearTimeout(searchTimeout);
      const resEl = document.getElementById('searchResults');
      if (!query.trim()) {
        resEl.style.display = 'none';
        resEl.innerHTML = '';
        return;
      }
      searchTimeout = setTimeout(() => {
        vscode.postMessage({ type: 'search', query });
      }, 250);
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'searchResults') {
        const resEl = document.getElementById('searchResults');
        if (!msg.hits.length) {
          resEl.innerHTML = '<div class="text-muted" style="padding: 8px;">No matching results.</div>';
          resEl.style.display = 'block';
          return;
        }
        resEl.innerHTML = msg.hits.map(h => {
          const cleanSnippet = h.snippet
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/«/g, '<mark>').replace(/»/g, '</mark>');
          return \`
            <div class="hit-item" onclick="openDoc('\${h.path}')">
              <div class="hit-header">
                <span>\${h.title} \${h.heading ? ' › ' + h.heading : ''}</span>
                <span class="badge success">\${h.score.toFixed(2)}</span>
              </div>
              <div class="doc-path">\${h.path}:L\${h.startLine}</div>
              <div class="hit-snippet">\${cleanSnippet}</div>
            </div>
          \`;
        }).join('');
        resEl.style.display = 'block';
      }
    });
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
