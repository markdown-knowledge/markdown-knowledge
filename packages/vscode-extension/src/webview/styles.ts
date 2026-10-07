/**
 * Global layout, workbench toolbar, sidebar, and theme tokens for MDK Webview
 */

export function getWorkbenchStyles(indexDotColor: string): string {
  return `
    /* ==========================================================================
       GLOBAL CSS RESET & THEME VARIABLES
       ========================================================================== */
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      color: var(--vscode-editor-foreground, #cccccc);
      background-color: var(--vscode-editor-background, #1e1e1e);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      font-size: 13px;
    }

    /* Custom Scrollbars */
    ::-webkit-scrollbar {
      width: 10px;
      height: 10px;
    }
    ::-webkit-scrollbar-thumb {
      background: var(--vscode-scrollbarSlider-background, rgba(121, 121, 121, 0.4));
      border-radius: 5px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: var(--vscode-scrollbarSlider-hoverBackground, rgba(100, 100, 100, 0.7));
    }
    ::-webkit-scrollbar-corner {
      background: transparent;
    }

    /* ==========================================================================
       1. TOP HEADER (32px)
       ========================================================================== */
    .top-header {
      height: 32px;
      min-height: 32px;
      background: var(--vscode-editorGroupHeader-tabsBackground, #1e1e1e);
      border-bottom: 1px solid var(--vscode-panel-border, rgba(255, 255, 255, 0.08));
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 12px;
      user-select: none;
      z-index: 10;
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
      color: var(--vscode-editor-foreground);
    }

    .doc-count-badge {
      font-size: 11px;
      background: var(--vscode-badge-background, #3a3d41);
      color: var(--vscode-badge-foreground, #fff);
      padding: 1px 7px;
      border-radius: 10px;
    }

    .index-indicator {
      display: inline-flex;
      align-items: center;
      gap: 6px;
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
      transition: all 0.15s ease;
    }

    button.btn-header:hover {
      background: var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.31));
      border-color: var(--vscode-toolbar-hoverOutline, transparent);
      color: var(--vscode-foreground, #fff);
    }

    button.btn-header.btn-primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }

    button.btn-header.btn-primary:hover {
      background: var(--vscode-button-hoverBackground);
    }

    /* ==========================================================================
       2. WORKSPACE SPLIT: SIDEBAR + DETAIL PANE
       ========================================================================== */
    .workspace {
      flex: 1;
      display: flex;
      overflow: hidden;
    }

    /* LEFT SIDEBAR: Document List & Search */
    .sidebar {
      width: 280px;
      min-width: 220px;
      max-width: 450px;
      background: var(--vscode-sideBar-background, #252526);
      border-right: 1px solid var(--vscode-panel-border, rgba(255, 255, 255, 0.08));
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .search-container {
      padding: 10px;
      border-bottom: 1px solid var(--vscode-panel-border, rgba(255, 255, 255, 0.08));
    }

    .search-input {
      width: 100%;
      padding: 6px 10px;
      font-size: 12px;
      border-radius: 4px;
      border: 1px solid var(--vscode-input-border, #3c3c3c);
      background: var(--vscode-input-background, #1e1e1e);
      color: var(--vscode-input-foreground, #fff);
      outline: none;
      transition: border-color 0.15s;
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
      padding: 8px 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 3px;
      transition: background 0.1s ease;
    }

    .doc-item:hover {
      background: var(--vscode-list-hoverBackground, rgba(90, 93, 94, 0.15));
    }

    .doc-item.active {
      background: var(--vscode-list-activeSelectionBackground, #094771);
      color: var(--vscode-list-activeSelectionForeground, #fff);
    }

    .doc-item-title {
      font-size: 12.5px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .doc-item-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #888);
    }

    .doc-item.active .doc-item-meta {
      color: rgba(255, 255, 255, 0.7);
    }

    .tag-badge {
      font-size: 9px;
      padding: 1px 5px;
      border-radius: 3px;
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
      height: 38px;
      min-height: 38px;
      border-bottom: 1px solid var(--vscode-panel-border, rgba(255, 255, 255, 0.08));
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      background: var(--vscode-editor-background, #1e1e1e);
      user-select: none;
    }

    .detail-doc-info {
      display: flex;
      align-items: center;
      gap: 10px;
      overflow: hidden;
    }

    .detail-doc-title {
      font-weight: 600;
      font-size: 13.5px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--vscode-editor-foreground);
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
      border-radius: 4px;
      overflow: hidden;
      background: rgba(255, 255, 255, 0.03);
    }

    .toggle-btn {
      background: transparent;
      color: var(--vscode-foreground, #ccc);
      border: none;
      padding: 4px 10px;
      font-size: 11px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: all 0.15s ease;
    }

    .toggle-btn:hover {
      background: var(--vscode-toolbar-hoverBackground, rgba(255, 255, 255, 0.08));
    }

    .toggle-btn.active {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }

    button.btn-tab-open {
      background: var(--vscode-button-secondaryBackground, #3a3d41);
      color: var(--vscode-button-secondaryForeground, #fff);
      border: none;
      border-radius: 4px;
      padding: 4px 10px;
      font-size: 11px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: background 0.15s ease;
    }

    button.btn-tab-open:hover {
      background: var(--vscode-button-secondaryHoverBackground, #45494e);
    }

    button.btn-save {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      padding: 4px 12px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: background 0.15s ease;
    }

    button.btn-save:hover {
      background: var(--vscode-button-hoverBackground);
    }

    /* ==========================================================================
       CONTENT LAYOUT: PREVIEW / EDIT / SPLIT MODES
       ========================================================================== */
    .content-layout {
      flex: 1;
      display: flex;
      overflow: hidden;
      position: relative;
    }

    .content-layout.mode-preview #editorPane {
      display: none !important;
    }
    .content-layout.mode-preview #previewPane {
      display: block !important;
      width: 100%;
    }

    .content-layout.mode-edit #previewPane {
      display: none !important;
    }
    .content-layout.mode-edit #editorPane {
      display: flex !important;
      width: 100%;
    }

    .content-layout.mode-split #previewPane {
      display: block !important;
      width: 50%;
      border-left: 1px solid var(--vscode-panel-border, rgba(255, 255, 255, 0.08));
    }
    .content-layout.mode-split #editorPane {
      display: flex !important;
      width: 50%;
    }

    /* Empty state */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--vscode-descriptionForeground, #888);
      gap: 12px;
      padding: 32px;
      text-align: center;
    }

    /* Search Results Highlight */
    .search-hit-snippet {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #aaa);
      margin-top: 3px;
      line-height: 1.35;
    }
    .search-hit-snippet mark {
      background: var(--vscode-editor-findMatchHighlightBackground, #ea5c0066);
      color: inherit;
      border-radius: 2px;
      padding: 0 2px;
    }
  `;
}
