import * as vscode from "vscode";
import { ContainerStore } from "./store";
import { normalizeDocPath } from "mdkn";

export const MDK_SCHEME = "mdk";

export interface MdkUriParts {
  containerFsPath: string;
  docPath: string;
}

export function toMdkUri(containerFsPath: string, docPath: string): vscode.Uri {
  const cleanDoc = docPath ? normalizeDocPath(docPath) : "";
  return vscode.Uri.from({
    scheme: MDK_SCHEME,
    path: "/" + cleanDoc,
    query: encodeURIComponent(containerFsPath),
  });
}

export function parseMdkUri(uri: vscode.Uri): MdkUriParts {
  const containerFsPath = decodeURIComponent(uri.query);
  let doc = uri.path;
  if (doc.startsWith("/")) doc = doc.slice(1);
  return {
    containerFsPath,
    docPath: doc,
  };
}

export class MdkFileSystemProvider implements vscode.FileSystemProvider {
  private _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._onDidChangeFile.event;

  constructor(private store: ContainerStore) {}

  watch(): vscode.Disposable {
    return { dispose: () => {} };
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const { containerFsPath, docPath } = parseMdkUri(uri);
    if (!containerFsPath) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    const container = await this.store.get(containerFsPath);
    // Root container directory
    if (!docPath) {
      return {
        type: vscode.FileType.Directory,
        ctime: Date.parse(container.manifest.createdAt),
        mtime: Date.parse(container.manifest.updatedAt),
        size: 0,
      };
    }

    // Check if it's a folder
    const folders = container.listFolders();
    if (folders.includes(docPath)) {
      return {
        type: vscode.FileType.Directory,
        ctime: Date.parse(container.manifest.createdAt),
        mtime: Date.parse(container.manifest.updatedAt),
        size: 0,
      };
    }

    // Check if it's a document
    if (container.hasDocument(docPath)) {
      const doc = container.getDocument(docPath);
      return {
        type: vscode.FileType.File,
        ctime: Date.parse(doc.createdAt),
        mtime: Date.parse(doc.updatedAt),
        size: doc.size,
      };
    }

    throw vscode.FileSystemError.FileNotFound(uri);
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const { containerFsPath, docPath } = parseMdkUri(uri);
    const container = await this.store.get(containerFsPath);
    const prefix = docPath ? docPath + "/" : "";

    const entries = new Map<string, vscode.FileType>();

    // Scan documents
    for (const doc of container.listDocuments()) {
      if (doc.path.startsWith(prefix)) {
        const rest = doc.path.slice(prefix.length);
        const slashIdx = rest.indexOf("/");
        if (slashIdx === -1) {
          // File directly in this directory
          entries.set(rest, vscode.FileType.File);
        } else {
          // Subfolder in this directory
          const dirName = rest.slice(0, slashIdx);
          entries.set(dirName, vscode.FileType.Directory);
        }
      }
    }

    return Array.from(entries.entries());
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const { containerFsPath, docPath } = parseMdkUri(uri);
    const container = await this.store.get(containerFsPath);
    try {
      const content = container.readDocument(docPath);
      return Buffer.from(content, "utf8");
    } catch {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean }
  ): Promise<void> {
    const { containerFsPath, docPath } = parseMdkUri(uri);
    const container = await this.store.get(containerFsPath);
    const text = Buffer.from(content).toString("utf8");

    const exists = container.hasDocument(docPath);
    if (!exists && !options.create) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    if (exists && !options.overwrite) {
      throw vscode.FileSystemError.FileExists(uri);
    }

    container.writeDocument(docPath, text);

    // Update index incrementally for this document
    try {
      const idx = await container.getIndex();
      idx.update({ paths: [docPath] });
    } catch (e) {
      console.warn("Index update warning on save:", e);
    }

    // Schedule container save
    await this.store.scheduleSave(containerFsPath, 300);

    this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  async delete(uri: vscode.Uri, options: { recursive: boolean }): Promise<void> {
    const { containerFsPath, docPath } = parseMdkUri(uri);
    const container = await this.store.get(containerFsPath);

    if (container.hasDocument(docPath)) {
      container.deleteDocument(docPath);
    } else if (options.recursive) {
      container.deleteFolder(docPath);
    } else {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    // Refresh index
    try {
      const idx = await container.getIndex();
      idx.update();
    } catch (e) {
      console.warn("Index update error after delete:", e);
    }

    await this.store.scheduleSave(containerFsPath, 100);
    this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
  }

  async rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): Promise<void> {
    const oldParts = parseMdkUri(oldUri);
    const newParts = parseMdkUri(newUri);
    if (oldParts.containerFsPath !== newParts.containerFsPath) {
      throw vscode.FileSystemError.NoPermissions("Moving documents between containers is not supported directly via rename");
    }
    const container = await this.store.get(oldParts.containerFsPath);
    if (!options.overwrite && container.hasDocument(newParts.docPath)) {
      throw vscode.FileSystemError.FileExists(newUri);
    }
    container.renameDocument(oldParts.docPath, newParts.docPath);

    try {
      const idx = await container.getIndex();
      idx.update();
    } catch (e) {
      console.warn("Index update error after rename:", e);
    }

    await this.store.scheduleSave(oldParts.containerFsPath, 100);
    this._onDidChangeFile.fire([
      { type: vscode.FileChangeType.Deleted, uri: oldUri },
      { type: vscode.FileChangeType.Created, uri: newUri },
    ]);
  }

  createDirectory(): void {
    // Folders in MDK are virtual / derived from document paths
  }
}
