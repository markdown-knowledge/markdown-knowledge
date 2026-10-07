import * as vscode from "vscode";
import * as path from "path";
import { ContainerStore } from "./store";
import { toMdkUri } from "./fsProvider";
import { DocumentInfo } from "mdkn";

export type MdkTreeItem = ContainerTreeItem | FolderTreeItem | DocumentTreeItem;

export class ContainerTreeItem extends vscode.TreeItem {
  constructor(
    public readonly containerFsPath: string,
    public readonly title: string,
    public readonly docCount: number
  ) {
    super(title || path.basename(containerFsPath), vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = "mdk.container";
    this.description = `${docCount} doc${docCount === 1 ? "" : "s"}`;
    this.tooltip = `${this.label} (${containerFsPath})\n${docCount} documents`;
    this.iconPath = new vscode.ThemeIcon("archive");
  }
}

export class FolderTreeItem extends vscode.TreeItem {
  constructor(
    public readonly containerFsPath: string,
    public readonly folderPath: string,
    public readonly folderName: string
  ) {
    super(folderName, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "mdk.folder";
    this.tooltip = folderPath;
    this.iconPath = new vscode.ThemeIcon("folder");
  }
}

export class DocumentTreeItem extends vscode.TreeItem {
  constructor(
    public readonly containerFsPath: string,
    public readonly doc: DocumentInfo
  ) {
    super(doc.title || path.basename(doc.path), vscode.TreeItemCollapsibleState.None);
    this.contextValue = "mdk.document";
    const tagStr = doc.tags.length ? `[${doc.tags.join(", ")}]` : "";
    this.description = tagStr ? `${path.basename(doc.path)} ${tagStr}` : path.basename(doc.path);
    this.tooltip = `${doc.title}\nPath: ${doc.path}\nSize: ${doc.size} bytes\nTags: ${doc.tags.join(", ") || "none"}`;
    this.iconPath = new vscode.ThemeIcon("markdown");
    this.resourceUri = toMdkUri(containerFsPath, doc.path);
    this.command = {
      command: "mdk.openDocument",
      title: "Open Document",
      arguments: [this],
    };
  }
}

export class MdkTreeDataProvider implements vscode.TreeDataProvider<MdkTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<MdkTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private store: ContainerStore) {
    this.store.onDidChange(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: MdkTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: MdkTreeItem): Promise<MdkTreeItem[]> {
    if (!element) {
      // Root: find all .mdk files in workspace
      const uris = await vscode.workspace.findFiles("**/*.mdk", "**/node_modules/**");
      const items: ContainerTreeItem[] = [];
      for (const uri of uris) {
        try {
          const container = await this.store.get(uri.fsPath);
          items.push(
            new ContainerTreeItem(
              uri.fsPath,
              container.manifest.title || path.basename(uri.fsPath),
              container.listDocuments().length
            )
          );
        } catch (e) {
          console.error("Error reading container:", uri.fsPath, e);
        }
      }
      return items.sort((a, b) => (a.label as string).localeCompare(b.label as string));
    }

    if (element instanceof ContainerTreeItem) {
      return this.getItemsInFolder(element.containerFsPath, "");
    }

    if (element instanceof FolderTreeItem) {
      return this.getItemsInFolder(element.containerFsPath, element.folderPath);
    }

    return [];
  }

  private async getItemsInFolder(containerFsPath: string, folder: string): Promise<MdkTreeItem[]> {
    const container = await this.store.get(containerFsPath);
    const prefix = folder ? folder + "/" : "";
    const directFolders = new Set<string>();
    const directDocs: DocumentInfo[] = [];

    for (const doc of container.listDocuments()) {
      if (doc.path.startsWith(prefix)) {
        const rest = doc.path.slice(prefix.length);
        const slashIdx = rest.indexOf("/");
        if (slashIdx === -1) {
          directDocs.push(doc);
        } else {
          directFolders.add(rest.slice(0, slashIdx));
        }
      }
    }

    const items: MdkTreeItem[] = [];
    for (const sub of Array.from(directFolders).sort()) {
      const fullSub = folder ? `${folder}/${sub}` : sub;
      items.push(new FolderTreeItem(containerFsPath, fullSub, sub));
    }
    for (const doc of directDocs.sort((a, b) => a.title.localeCompare(b.title))) {
      items.push(new DocumentTreeItem(containerFsPath, doc));
    }
    return items;
  }
}
