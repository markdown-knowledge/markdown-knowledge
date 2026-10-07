import * as vscode from "vscode";
import * as path from "path";
import { MdkContainer, configureSqlite } from "markdown-knowledge";

export class ContainerStore implements vscode.Disposable {
  private containers = new Map<string, MdkContainer>();
  private saveTimers = new Map<string, NodeJS.Timeout>();
  private disposables: vscode.Disposable[] = [];

  private _onDidChange = new vscode.EventEmitter<string>();
  public readonly onDidChange = this._onDidChange.event;

  constructor(private context: vscode.ExtensionContext) {
    const wasmPath = path.join(context.extensionPath, "dist", "sql-wasm.wasm");
    configureSqlite({ wasmPath });

    // Watch for external changes to .mdk files
    const watcher = vscode.workspace.createFileSystemWatcher("**/*.mdk");
    watcher.onDidChange((uri) => this.invalidate(uri.fsPath));
    watcher.onDidDelete((uri) => this.remove(uri.fsPath));
    this.disposables.push(watcher, this._onDidChange);
  }

  normalizePath(fsPath: string): string {
    return path.resolve(fsPath);
  }

  async get(containerFsPath: string): Promise<MdkContainer> {
    const norm = this.normalizePath(containerFsPath);
    let container = this.containers.get(norm);
    if (!container) {
      container = await MdkContainer.open(norm);
      this.containers.set(norm, container);
    }
    return container;
  }

  invalidate(containerFsPath: string): void {
    const norm = this.normalizePath(containerFsPath);
    const existing = this.containers.get(norm);
    if (existing) {
      existing.close();
      this.containers.delete(norm);
      this._onDidChange.fire(norm);
    }
  }

  remove(containerFsPath: string): void {
    const norm = this.normalizePath(containerFsPath);
    const timer = this.saveTimers.get(norm);
    if (timer) {
      clearTimeout(timer);
      this.saveTimers.delete(norm);
    }
    const existing = this.containers.get(norm);
    if (existing) {
      existing.close();
      this.containers.delete(norm);
      this._onDidChange.fire(norm);
    }
  }

  /**
   * Schedule saving the container with debouncing.
   */
  scheduleSave(containerFsPath: string, delayMs = 400): Promise<void> {
    const norm = this.normalizePath(containerFsPath);
    const existingTimer = this.saveTimers.get(norm);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(async () => {
        this.saveTimers.delete(norm);
        try {
          const container = this.containers.get(norm);
          if (container && container.dirty) {
            await container.save();
            this._onDidChange.fire(norm);
          }
          resolve();
        } catch (err) {
          reject(err);
        }
      }, delayMs);
      this.saveTimers.set(norm, timer);
    });
  }

  async saveImmediately(containerFsPath: string): Promise<void> {
    const norm = this.normalizePath(containerFsPath);
    const existingTimer = this.saveTimers.get(norm);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.saveTimers.delete(norm);
    }
    const container = this.containers.get(norm);
    if (container && container.dirty) {
      await container.save();
      this._onDidChange.fire(norm);
    }
  }

  dispose(): void {
    for (const timer of this.saveTimers.values()) {
      clearTimeout(timer);
    }
    for (const container of this.containers.values()) {
      container.close();
    }
    this.containers.clear();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
