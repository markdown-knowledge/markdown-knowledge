# Markdown Knowledge (`.mdk`)

**Markdown Knowledge** is a single-file knowledge container format (`.mdk`) holding multiple Markdown documents with an embedded **SQLite full-text index** (FTS). It is designed to be edited seamlessly in VS Code and queried/retrieved by AI agents via the unified **`mdkn`** npm package and CLI.

---

## Workspace Structure

- [packages/mdkn](file:///d:/Projects%20Files/markdown-knowledge/packages/mdkn) — Unified `mdkn` npm package (CLI executable + Node.js programmatic library)
- [packages/vscode-extension](file:///d:/Projects%20Files/markdown-knowledge/packages/vscode-extension) — `mdk-vscode` VS Code extension (virtual `mdk:` filesystem, TreeView, interactive Dashboard editor with live search)
- [examples](file:///d:/Projects%20Files/markdown-knowledge/examples) — Sample documents and test `.mdk` files

---

## Installation

```bash
# Install CLI globally (provides both 'mdkn' and 'mdk' commands)
npm install -g mdkn

# Or install in a project
npm install mdkn
```

---

## CLI Reference (`mdkn` or `mdk`)

Every command can be run using either **`mdkn`** or the shorthand alias **`mdk`**.  
Every command accepts **`--json`** for machine-readable output designed for AI agents.

### Container Management

```bash
# Create a new empty container
mdkn init handbook.mdk --title "Team Handbook"

# View container metadata and SQLite index freshness
mdkn info handbook.mdk
```

### Viewing & Exploring Documents

```bash
# List all documents inside container
mdkn ls handbook.mdk

# Filter by glob or tag
mdkn ls handbook.mdk "guides/**" --tag ops

# View document content
mdkn cat handbook.mdk guides/deploy.md

# View heading outline and line numbers (useful before targeting sections)
mdkn outline handbook.mdk guides/deploy.md
```

### Adding & Editing Documents

```bash
# Add a document with metadata (front matter is automatically managed)
mdkn add handbook.mdk guides/deploy.md --title "Deploying" --tags "ops,k8s" --file ./deploy.md

# Add from inline text or stdin
mdkn add handbook.mdk intro.md --content "# Welcome\nTeam documentation."
echo "# Notes" | mdkn add handbook.mdk notes.md --stdin

# Insert content into a specific section of a document
# Positions: start | end | before | after | replace
mdkn insert handbook.mdk guides/deploy.md \
  --section "Kubernetes" \
  --position end \
  --content "- Run helm test before promoting."

# Append content to the end of a document
mdkn insert handbook.mdk guides/deploy.md --content "Canary deployments use Argo Rollouts."

# Rename / Move a document
mdkn mv handbook.mdk old-name.md new-name.md

# Delete documents
mdkn rm handbook.mdk draft.md obsolete.md
```

### Bulk Import & Export

```bash
# Import a folder of markdown files into the container
mdkn import handbook.mdk ./my-docs --prefix guides

# Extract all documents from container to local directory
mdkn export handbook.mdk ./extracted-docs
```

### SQLite Search Index

```bash
# Incrementally build or refresh the SQLite search index
mdkn index handbook.mdk

# Complete rebuild of the search index
mdkn index handbook.mdk --rebuild

# Check index freshness status
mdkn index handbook.mdk --status

# Tip: Add '--index' to any mutating command (add, insert, rm, mv, import) 
# to update the SQLite search index in the same write:
mdkn add handbook.mdk faq.md --file ./faq.md --index
```

### Search & AI Context Retrieval

```bash
# Full-text search with Okapi BM25 ranking and highlighted snippets
mdkn search handbook.mdk "how to roll back helm"

# Output structured JSON for AI agent tool calls
mdkn search handbook.mdk "rollback" --json

# Retrieve token-budgeted context bundle for LLM prompts (default 4000 tokens)
mdkn retrieve handbook.mdk "how to roll back helm release" --max-tokens 500

# Retrieve whole documents instead of chunked sections
mdkn retrieve handbook.mdk "database incident response" --expand document
```

---

## Programmatic API (`mdkn`)

```typescript
import { MdkContainer, retrieve, formatRetrieveMarkdown } from "mdkn";

// 1. Open or create a container
const mdk = await MdkContainer.open("handbook.mdk");

// 2. Read / Write documents
mdk.writeDocument("guides/deploy.md", markdownContent, {
  title: "Deploying",
  tags: ["ops"],
});

// 3. Section-aware insertion
mdk.insertContent("guides/deploy.md", "New note", {
  section: "Kubernetes",
  position: "end",
});

// 4. Indexing with SQLite inside the container
const index = await mdk.getIndex();
index.update(); // Incremental based on content hashes

// 5. Search & Retrieval for AI
const hits = index.search("helm rollback");
const context = await retrieve(mdk, "how do I rollback", { maxTokens: 1000 });
console.log(formatRetrieveMarkdown(context));

// 6. Save changes back to .mdk container atomically
await mdk.save();
```

---

## Publishing to npm

To publish the unified package:

```bash
npm publish --workspace=mdkn --access public
```

---

## VS Code Extension (`mdk-vscode`)

1. **Virtual FileSystem (`mdk:`)**: Documents inside `.mdk` files are opened directly as normal Markdown documents in VS Code. Saving writes back to the `.mdk` container and refreshes the search index automatically.
2. **Activity Bar View**: The **Markdown Knowledge** explorer displays all `.mdk` containers in the workspace with their directory hierarchy and documents.
3. **Interactive Dashboard**: Opening any `*.mdk` file opens a dashboard webview featuring container statistics, search index health, quick actions, document browser, and a **live full-text search bar**.
