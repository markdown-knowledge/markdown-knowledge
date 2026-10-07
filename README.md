# Markdown Knowledge (`.mdk`)

**Markdown Knowledge** is a single-file knowledge container format (`.mdk`) holding multiple Markdown documents with an embedded **SQLite full-text index** (FTS). It is designed to be edited seamlessly in VS Code and queried/retrieved by AI agents via the unified **`mdkn`** npm package and CLI.

---

## Workspace Structure

- [packages/mdkn](file:///d:/Projects%20Files/markdown-knowledge/packages/mdkn) — Unified `mdkn` npm package (CLI executable + Node.js programmatic library)
- [packages/vscode-extension](file:///d:/Projects%20Files/markdown-knowledge/packages/vscode-extension) — `mdk-vscode` VS Code extension (virtual `mdk:` filesystem, TreeView, interactive Dashboard editor with live search)
- [examples](file:///d:/Projects%20Files/markdown-knowledge/examples) — Sample documents and test `.mdk` files

---

## Installation & Build

```bash
# Install dependencies
npm install

# Build all packages (mdkn and mdk-vscode)
npm run build

# Run test suite
npm test
```

---

## CLI Usage (`mdkn` or `mdk`)

The CLI commands can be invoked using either **`mdkn`** or **`mdk`**.

### 1. Create a container
```bash
mdkn init handbook.mdk --title "Team Handbook"
```

### 2. Insert a document into container
```bash
# From inline text
mdkn add handbook.mdk guides/deploy.md --title "Deploying" --tags "ops,k8s" --content "# Deploying\n\n## Kubernetes\nHelm charts are used."

# From an existing file
mdkn add handbook.mdk faq.md --file ./faq.md

# From stdin
echo "# Quickstart" | mdkn add handbook.mdk quickstart.md --stdin
```

### 3. Insert content into a single Markdown file inside `.mdk`
```bash
# Append to the end of a document
mdkn insert handbook.mdk guides/deploy.md --content "Canary releases use Argo Rollouts."

# Insert into a specific section (by heading text or breadcrumb)
mdkn insert handbook.mdk guides/deploy.md \
  --section "Kubernetes" \
  --position end \
  --content "- Run helm test before promoting."

# Positions: start | end | before | after | replace
```

### 4. Build or update SQLite search index inside `.mdk`
```bash
# Incremental index update
mdkn index handbook.mdk

# Complete rebuild
mdkn index handbook.mdk --rebuild

# Check index status without modifying
mdkn index handbook.mdk --status
```

### 5. Search & retrieve documents for AI agents

```bash
# Ranked full-text search (BM25)
mdkn search handbook.mdk "how to roll back helm"

# Machine-readable output for AI agents (--json)
mdkn search handbook.mdk "rollback" --json

# Token-budgeted context bundle retrieval for LLM prompts
mdkn retrieve handbook.mdk "how to roll back helm release" --max-tokens 500

# Document-level retrieval (returns whole markdown files of top hits)
mdkn retrieve handbook.mdk "database incidents" --expand document
```

---

## Programmatic API (`mdkn`)

```typescript
import { MdkContainer, retrieve, formatRetrieveMarkdown } from "mdkn";

// 1. Open or create
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

Users can then install it with:
```bash
npm install -g mdkn
```
Or run directly with:
```bash
npx mdkn search handbook.mdk "query"
```

---

## VS Code Extension (`mdk-vscode`)

1. **Virtual FileSystem (`mdk:`)**: Documents inside `.mdk` files are opened directly as normal Markdown documents in VS Code. Saving writes back to the `.mdk` container and refreshes the search index automatically.
2. **Activity Bar View**: The **Markdown Knowledge** explorer displays all `.mdk` containers in the workspace with their directory hierarchy and documents.
3. **Interactive Dashboard**: Opening any `*.mdk` file opens a dashboard webview featuring container statistics, search index health, quick actions, document browser, and a **live full-text search bar**.
