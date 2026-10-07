import * as vscode from "vscode";
import * as path from "path";
import { ContainerStore } from "./store";
import { MdkFileSystemProvider, MDK_SCHEME, toMdkUri, parseMdkUri } from "./fsProvider";
import { MdkTreeDataProvider, ContainerTreeItem, DocumentTreeItem, FolderTreeItem } from "./treeView";
import { MdkDashboardProvider } from "./dashboard";
import { MdkContainer } from "mdkn";

export function activate(context: vscode.ExtensionContext) {
  const store = new ContainerStore(context);
  context.subscriptions.push(store);

  // 1. FileSystemProvider
  const fsProvider = new MdkFileSystemProvider(store);
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(MDK_SCHEME, fsProvider, {
      isCaseSensitive: true,
    })
  );

  // 2. Tree View
  const treeProvider = new MdkTreeDataProvider(store);
  const treeView = vscode.window.createTreeView("mdk.containers", {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // 3. Custom Editor (Dashboard for *.mdk)
  const dashboardProvider = new MdkDashboardProvider(context, store);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider("mdk.dashboard", dashboardProvider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    })
  );

  // Helper to resolve container path from command argument
  async function resolveContainerFsPath(item?: any): Promise<string | undefined> {
    if (item?.containerFsPath) return item.containerFsPath;
    if (item instanceof vscode.Uri) {
      if (item.scheme === MDK_SCHEME) return parseMdkUri(item).containerFsPath;
      if (item.fsPath.endsWith(".mdk")) return item.fsPath;
    }
    // Try currently active editor
    const activeDoc = vscode.window.activeTextEditor?.document.uri;
    if (activeDoc?.scheme === MDK_SCHEME) {
      return parseMdkUri(activeDoc).containerFsPath;
    }
    // Prompt from workspace containers
    const files = await vscode.workspace.findFiles("**/*.mdk", "**/node_modules/**");
    if (!files.length) {
      vscode.window.showInformationMessage("No .mdk containers found in workspace. Create one first!");
      return undefined;
    }
    if (files.length === 1) return files[0].fsPath;

    const picks = files.map((f) => ({
      label: path.basename(f.fsPath),
      description: f.fsPath,
      fsPath: f.fsPath,
    }));
    const chosen = await vscode.window.showQuickPick(picks, { placeHolder: "Select a container" });
    return chosen?.fsPath;
  }

  // 4. Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("mdk.refresh", () => {
      treeProvider.refresh();
    }),

    vscode.commands.registerCommand("mdk.newContainer", async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      const defaultDir = workspaceFolders?.[0]?.uri.fsPath || "";

      const fileUri = await vscode.window.showSaveDialog({
        defaultUri: defaultDir ? vscode.Uri.file(path.join(defaultDir, "knowledge.mdk")) : undefined,
        filters: { "Markdown Knowledge": ["mdk"] },
        saveLabel: "Create Container",
      });
      if (!fileUri) return;

      const title = await vscode.window.showInputBox({
        prompt: "Container Title",
        value: path.basename(fileUri.fsPath, ".mdk"),
      });

      try {
        await MdkContainer.create(fileUri.fsPath, { title: title || undefined });
        vscode.window.showInformationMessage(`Created container: ${path.basename(fileUri.fsPath)}`);
        treeProvider.refresh();
        await vscode.commands.executeCommand("vscode.open", fileUri);
      } catch (e: any) {
        vscode.window.showErrorMessage(`Failed to create container: ${e.message}`);
      }
    }),

    vscode.commands.registerCommand("mdk.openContainer", async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { "Markdown Knowledge": ["mdk"] },
      });
      if (uris && uris[0]) {
        await vscode.commands.executeCommand("vscode.open", uris[0]);
      }
    }),

    vscode.commands.registerCommand("mdk.openDashboard", async (item?: ContainerTreeItem) => {
      const containerPath = await resolveContainerFsPath(item);
      if (containerPath) {
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(containerPath));
      }
    }),

    vscode.commands.registerCommand("mdk.openDocument", async (item: DocumentTreeItem | vscode.Uri) => {
      let uri: vscode.Uri;
      if (item instanceof DocumentTreeItem) {
        uri = toMdkUri(item.containerFsPath, item.doc.path);
      } else if (item instanceof vscode.Uri) {
        uri = item;
      } else {
        return;
      }
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });
    }),

    vscode.commands.registerCommand("mdk.addDocument", async (item?: any) => {
      const containerPath = await resolveContainerFsPath(item);
      if (!containerPath) return;

      let folderPrefix = "";
      if (item instanceof FolderTreeItem) {
        folderPrefix = item.folderPath + "/";
      }

      const docPathInput = await vscode.window.showInputBox({
        prompt: "Document path inside container (e.g. guides/getting-started.md)",
        value: folderPrefix,
      });
      if (!docPathInput) return;

      const docTitle = await vscode.window.showInputBox({
        prompt: "Document title",
        value: path.basename(docPathInput, ".md").replace(/[-_]/g, " "),
      });

      try {
        const container = await store.get(containerPath);
        const initialContent = `# ${docTitle || "Untitled"}\n\n`;
        const doc = container.writeDocument(docPathInput, initialContent, {
          title: docTitle || undefined,
        });

        // Update index & save container
        const idx = await container.getIndex();
        idx.update({ paths: [doc.path] });
        await store.saveImmediately(containerPath);

        treeProvider.refresh();

        const docUri = toMdkUri(containerPath, doc.path);
        const textDoc = await vscode.workspace.openTextDocument(docUri);
        await vscode.window.showTextDocument(textDoc, { preview: false });
      } catch (e: any) {
        vscode.window.showErrorMessage(`Failed to add document: ${e.message}`);
      }
    }),

    vscode.commands.registerCommand("mdk.renameDocument", async (item?: DocumentTreeItem) => {
      if (!item) return;
      const newPath = await vscode.window.showInputBox({
        prompt: "New document path",
        value: item.doc.path,
      });
      if (!newPath || newPath === item.doc.path) return;

      try {
        const container = await store.get(item.containerFsPath);
        container.renameDocument(item.doc.path, newPath);
        const idx = await container.getIndex();
        idx.update();
        await store.saveImmediately(item.containerFsPath);
        treeProvider.refresh();
      } catch (e: any) {
        vscode.window.showErrorMessage(`Failed to rename document: ${e.message}`);
      }
    }),

    vscode.commands.registerCommand("mdk.deleteDocument", async (item?: DocumentTreeItem) => {
      if (!item) return;
      const confirm = await vscode.window.showWarningMessage(
        `Are you sure you want to delete "${item.doc.path}"?`,
        { modal: true },
        "Delete"
      );
      if (confirm !== "Delete") return;

      try {
        const container = await store.get(item.containerFsPath);
        container.deleteDocument(item.doc.path);
        const idx = await container.getIndex();
        idx.update();
        await store.saveImmediately(item.containerFsPath);
        treeProvider.refresh();
      } catch (e: any) {
        vscode.window.showErrorMessage(`Failed to delete document: ${e.message}`);
      }
    }),

    vscode.commands.registerCommand("mdk.importFolder", async (item?: any) => {
      const containerPath = await resolveContainerFsPath(item);
      if (!containerPath) return;

      const folderUris = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: "Import Markdown Folder",
      });
      if (!folderUris || !folderUris[0]) return;

      const prefix = await vscode.window.showInputBox({
        prompt: "Optional folder prefix inside container (leave blank for root)",
        value: "",
      });

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Importing markdown files...",
          cancellable: false,
        },
        async () => {
          const container = await store.get(containerPath);
          const imported = await container.importDirectory(folderUris[0].fsPath, {
            prefix: prefix || undefined,
          });
          const idx = await container.getIndex();
          idx.update();
          await store.saveImmediately(containerPath);
          treeProvider.refresh();
          vscode.window.showInformationMessage(`Imported ${imported.length} document(s).`);
        }
      );
    }),

    vscode.commands.registerCommand("mdk.rebuildIndex", async (item?: any) => {
      const containerPath = await resolveContainerFsPath(item);
      if (!containerPath) return;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Rebuilding SQLite Search Index...",
          cancellable: false,
        },
        async () => {
          try {
            const container = await store.get(containerPath);
            const idx = await container.getIndex();
            const stats = idx.update({ rebuild: true });
            await store.saveImmediately(containerPath);
            treeProvider.refresh();
            vscode.window.showInformationMessage(
              `Index rebuilt: ${stats.chunks} chunks indexed in ${stats.durationMs}ms.`
            );
          } catch (e: any) {
            vscode.window.showErrorMessage(`Failed to rebuild index: ${e.message}`);
          }
        }
      );
    }),

    vscode.commands.registerCommand("mdk.search", async (item?: any) => {
      const containerPath = await resolveContainerFsPath(item);
      if (!containerPath) return;

      const container = await store.get(containerPath);
      const idx = await container.getIndex();

      const quickPick = vscode.window.createQuickPick();
      quickPick.placeholder = "Search documents (FTS4 BM25)...";
      quickPick.matchOnDescription = true;
      quickPick.matchOnDetail = true;

      quickPick.onDidChangeValue((query) => {
        if (!query.trim()) {
          quickPick.items = [];
          return;
        }
        try {
          const hits = idx.search(query, { limit: 20 });
          quickPick.items = hits.map((h) => ({
            label: `$(markdown) ${h.title} ${h.heading ? "› " + h.heading : ""}`,
            description: `${h.path}:L${h.startLine} (score: ${h.score.toFixed(2)})`,
            detail: h.snippet.replace(/«/g, "**").replace(/»/g, "**"),
            hit: h,
          } as vscode.QuickPickItem & { hit: any }));
        } catch {
          quickPick.items = [];
        }
      });

      quickPick.onDidAccept(async () => {
        const selected = quickPick.selectedItems[0] as any;
        if (selected?.hit) {
          quickPick.hide();
          const docUri = toMdkUri(containerPath, selected.hit.path);
          const doc = await vscode.workspace.openTextDocument(docUri);
          const editor = await vscode.window.showTextDocument(doc, { preview: false });
          const line = Math.max(0, selected.hit.startLine - 1);
          const pos = new vscode.Position(line, 0);
          editor.selection = new vscode.Selection(pos, pos);
          editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        }
      });

      quickPick.show();
    })
  );
}

export function deactivate() {}
