import * as vscode from "vscode";
import * as path from "path";
import { ContainerStore } from "./store";
import { toMdkUri } from "./fsProvider";
import { renderMarkdown, getPreviewStyles, getPreviewScript } from "./webview/preview";
import { getEditorStyles, getEditorToolbarHtml, getEditorScript } from "./webview/editor";
import { getWorkbenchStyles } from "./webview/styles";
import { DashboardViewData } from "./webview/types";

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
          const { html: rendered, frontmatter } = renderMarkdown(raw);
          const tokens = Math.ceil(raw.length / 4);

          webviewPanel.webview.postMessage({
            type: "docLoaded",
            doc: {
              path: docInfo.path,
              title: docInfo.title,
              tags: docInfo.tags,
              size: docInfo.size,
              tokens,
              updatedAt: docInfo.updatedAt,
              raw,
              rendered,
              frontmatter,
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

        webviewPanel.webview.html = this.buildWorkbenchHtml(webviewPanel.webview, {
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
        case "requestPreviewRender": {
          const { html: rendered } = renderMarkdown(msg.raw || "");
          webviewPanel.webview.postMessage({
            type: "previewRendered",
            rendered,
          });
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

  private buildWorkbenchHtml(webview: vscode.Webview, data: DashboardViewData): string {
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
    ${getWorkbenchStyles(indexDotColor)}
    ${getPreviewStyles()}
    ${getEditorStyles()}
  </style>
</head>
<body>

  <!-- 1. TOP HEADER (32px status & global actions) -->
  <header class="top-header">
    <div class="header-left">
      <div class="container-title">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"></path>
          <path d="M6 6h10"></path>
          <path d="M6 10h10"></path>
        </svg>
        <span>${escapeHtml(data.title)}</span>
      </div>
      <span class="doc-count-badge">${data.docCount} docs</span>
      <div class="index-indicator" title="${escapeHtml(indexStatusText)}">
        <span class="status-dot"></span>
        <span>${escapeHtml(indexStatusText)}</span>
      </div>
    </div>

    <div class="header-actions">
      <button class="btn-header btn-primary" onclick="handleAddDoc()" title="Add Document">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
        New Doc
      </button>
      <button class="btn-header" onclick="handleRebuildIndex()" title="Re-index Container">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
        Re-index
      </button>
      <button class="btn-header" onclick="handleImportFolder()" title="Import Directory">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
        Import
      </button>
    </div>
  </header>

  <!-- 2. MAIN WORKSPACE -->
  <main class="workspace">
    <!-- LEFT SIDEBAR: Document List & Search -->
    <aside class="sidebar">
      <div class="search-container">
        <input type="text" class="search-input" id="searchInput" placeholder="Filter documents or full-text search..." />
      </div>
      <ul class="sidebar-list" id="docList"></ul>
    </aside>

    <!-- RIGHT DETAIL PANE: Rendered Preview & Inline Editor -->
    <section class="detail-pane">
      <div class="detail-toolbar">
        <div class="detail-doc-info">
          <span class="detail-doc-title" id="activeDocTitle">No document selected</span>
          <span class="detail-doc-path" id="activeDocPath"></span>
        </div>

        <div class="detail-actions">
          <div class="view-mode-toggle">
            <button class="toggle-btn active" id="btnModePreview" onclick="setViewMode('preview')" title="Rendered Preview">Preview</button>
            <button class="toggle-btn" id="btnModeEdit" onclick="setViewMode('edit')" title="Inline Markdown Editor">Edit</button>
            <button class="toggle-btn" id="btnModeSplit" onclick="setViewMode('split')" title="Side-by-side Live Split">Split</button>
          </div>

          <button class="btn-tab-open" onclick="openCurrentInTab()" title="Open document in native editor tab">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/></svg>
            Open in Tab
          </button>

          <button class="btn-save" id="btnSave" onclick="saveCurrentDocument()" title="Save Changes (Ctrl+S)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8"/></svg>
            Save
          </button>
        </div>
      </div>

      <!-- Content Area with Preview and Editor -->
      <div class="content-layout mode-preview" id="contentLayout">
        
        <!-- PREVIEW PANE -->
        <div class="preview-pane" id="previewPane">
          <div class="markdown-container">
            <div class="doc-meta-card" id="docMetaCard" style="display: none;">
              <div class="doc-meta-header">
                <span class="doc-meta-title" id="metaCardTitle"></span>
              </div>
              <div class="doc-meta-pills" id="metaCardPills"></div>
            </div>
            <article class="markdown-body" id="previewMarkdownBody">
              <div class="empty-state">Select a document from the left sidebar to view its content.</div>
            </article>
          </div>
        </div>

        <!-- EDITOR PANE -->
        <div class="editor-pane" id="editorPane">
          ${getEditorToolbarHtml()}
          
          <div class="editor-canvas-container">
            <div class="editor-gutter" id="editorGutter">
              <span class="editor-line-no">1</span>
            </div>
            <div class="editor-textarea-wrapper">
              <textarea class="editor-textarea" id="editorTextarea" spellcheck="false" placeholder="Write markdown here..."></textarea>
            </div>
          </div>

          <div class="editor-statusbar">
            <div class="editor-statusbar-left">
              <span class="dirty-pill is-saved" id="dirtyIndicator">✓ Saved</span>
            </div>
            <div class="editor-statusbar-right">
              <span class="status-item" id="statusStats">0 lines, 0 words</span>
            </div>
          </div>
        </div>

      </div>
    </section>
  </main>

  <script>
    const vscode = acquireVsCodeApi();
    const allDocuments = ${docsJson};
    let currentDocPath = ${JSON.stringify(data.activeDocPath)};
    let currentDocData = null;
    let currentViewMode = "preview"; // 'preview' | 'edit' | 'split'

    ${getPreviewScript()}
    ${getEditorScript()}

    function init() {
      renderDocList(allDocuments);
      setupSearchListener();
      setupEditorListeners();
      setViewMode("preview");
    }

    function setViewMode(mode) {
      currentViewMode = mode;
      const layout = document.getElementById("contentLayout");
      layout.className = "content-layout mode-" + mode;

      document.getElementById("btnModePreview").classList.toggle("active", mode === "preview");
      document.getElementById("btnModeEdit").classList.toggle("active", mode === "edit");
      document.getElementById("btnModeSplit").classList.toggle("active", mode === "split");

      if (mode === "edit" || mode === "split") {
        setTimeout(() => {
          updateEditorMetrics();
          const textarea = document.getElementById("editorTextarea");
          if (textarea && mode === "edit") textarea.focus();
        }, 50);
      }
    }

    function renderDocList(docs) {
      const list = document.getElementById("docList");
      list.innerHTML = "";
      if (!docs.length) {
        list.innerHTML = '<li style="padding: 16px; color: var(--vscode-descriptionForeground); text-align: center;">No documents match.</li>';
        return;
      }

      docs.forEach(d => {
        const li = document.createElement("li");
        li.className = "doc-item" + (d.path === currentDocPath ? " active" : "");
        li.dataset.path = d.path;

        const titleDiv = document.createElement("div");
        titleDiv.className = "doc-item-title";
        titleDiv.innerText = d.title || d.path;

        const metaDiv = document.createElement("div");
        metaDiv.className = "doc-item-meta";
        const tokensEst = Math.ceil((d.size || 0) / 4);
        metaDiv.innerHTML = '<span>' + d.path + '</span><span>~' + tokensEst + ' tkn</span>';

        li.appendChild(titleDiv);
        li.appendChild(metaDiv);

        li.onclick = () => {
          if (isDocDirty) {
            if (!confirm("You have unsaved changes in the current document. Discard and switch?")) {
              return;
            }
          }
          currentDocPath = d.path;
          document.querySelectorAll(".doc-item").forEach(el => el.classList.remove("active"));
          li.classList.add("active");
          vscode.postMessage({ type: "selectDoc", docPath: d.path });
        };

        list.appendChild(li);
      });
    }

    function setupSearchListener() {
      const input = document.getElementById("searchInput");
      let debounceTimer = null;

      input.addEventListener("input", (e) => {
        clearTimeout(debounceTimer);
        const q = e.target.value.trim();

        if (!q) {
          renderDocList(allDocuments);
          return;
        }

        debounceTimer = setTimeout(() => {
          // If query is longer than 2 characters, perform full-text search
          if (q.length >= 2) {
            vscode.postMessage({ type: "search", query: q });
          } else {
            // Local prefix filter
            const filtered = allDocuments.filter(d => 
              d.path.toLowerCase().includes(q.toLowerCase()) || 
              (d.title && d.title.toLowerCase().includes(q.toLowerCase()))
            );
            renderDocList(filtered);
          }
        }, 200);
      });
    }

    function openCurrentInTab() {
      if (!currentDocPath) return;
      vscode.postMessage({ type: "openInTab", docPath: currentDocPath });
    }

    function saveCurrentDocument() {
      if (!currentDocPath) return;
      const textarea = document.getElementById("editorTextarea");
      const content = textarea.value;
      vscode.postMessage({
        type: "saveDoc",
        docPath: currentDocPath,
        content: content
      });
      initialDocContent = content;
      checkDirtyState();
    }

    function handleAddDoc() { vscode.postMessage({ type: "addDoc" }); }
    function handleImportFolder() { vscode.postMessage({ type: "importFolder" }); }
    function handleRebuildIndex() { vscode.postMessage({ type: "rebuildIndex" }); }

    // Incoming messages from Extension host
    window.addEventListener("message", (event) => {
      const msg = event.data;
      switch (msg.type) {
        case "docLoaded": {
          currentDocData = msg.doc;
          currentDocPath = msg.doc.path;
          initialDocContent = msg.doc.raw;

          // Header
          document.getElementById("activeDocTitle").innerText = msg.doc.title || msg.doc.path;
          document.getElementById("activeDocPath").innerText = msg.doc.path;

          // Preview Meta Card
          const metaCard = document.getElementById("docMetaCard");
          const metaTitle = document.getElementById("metaCardTitle");
          const metaPills = document.getElementById("metaCardPills");
          metaCard.style.display = "flex";
          metaTitle.innerText = msg.doc.title || msg.doc.path;
          
          let pillsHtml = '<span class="pill pill-path">' + msg.doc.path + '</span>';
          pillsHtml += '<span class="pill">~' + msg.doc.tokens + ' tokens</span>';
          pillsHtml += '<span class="pill">' + msg.doc.size + ' bytes</span>';
          if (msg.doc.tags && msg.doc.tags.length) {
            msg.doc.tags.forEach(t => {
              pillsHtml += '<span class="pill pill-tag">#' + t + '</span>';
            });
          }
          metaPills.innerHTML = pillsHtml;

          // Rendered preview HTML
          document.getElementById("previewMarkdownBody").innerHTML = msg.doc.rendered;

          // Editor Textarea
          const textarea = document.getElementById("editorTextarea");
          textarea.value = msg.doc.raw;
          updateEditorMetrics();
          checkDirtyState();
          break;
        }

        case "previewRendered": {
          document.getElementById("previewMarkdownBody").innerHTML = msg.rendered;
          break;
        }

        case "searchResults": {
          renderSearchResults(msg.hits);
          break;
        }
      }
    });

    function renderSearchResults(hits) {
      const list = document.getElementById("docList");
      list.innerHTML = "";
      if (!hits.length) {
        list.innerHTML = '<li style="padding: 16px; color: var(--vscode-descriptionForeground); text-align: center;">No matches found.</li>';
        return;
      }

      hits.forEach(h => {
        const li = document.createElement("li");
        li.className = "doc-item" + (h.path === currentDocPath ? " active" : "");
        li.dataset.path = h.path;

        const titleDiv = document.createElement("div");
        titleDiv.className = "doc-item-title";
        titleDiv.innerText = h.title || h.path;

        const snippetDiv = document.createElement("div");
        snippetDiv.className = "search-hit-snippet";
        snippetDiv.innerHTML = h.snippet;

        li.appendChild(titleDiv);
        li.appendChild(snippetDiv);

        li.onclick = () => {
          currentDocPath = h.path;
          document.querySelectorAll(".doc-item").forEach(el => el.classList.remove("active"));
          li.classList.add("active");
          vscode.postMessage({ type: "selectDoc", docPath: h.path });
        };

        list.appendChild(li);
      });
    }

    init();
  </script>
</body>
</html>`;
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
