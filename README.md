# Markdown Knowledge (`.mdk`)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/markdown-knowledge.svg)](https://www.npmjs.com/package/markdown-knowledge)

**Markdown Knowledge** is a single-file knowledge container format (`.mdk`) that packages multiple Markdown documents together with an embedded **SQLite full-text index** (FTS).

It is designed for two worlds:
1. **Humans**: Edit documents natively in VS Code with full preview and syntax highlighting.
2. **AI Agents & LLMs**: Search and retrieve token-budgeted context through a fast, lightweight CLI and Node.js library.

---

## Highlights

- 📦 **Single Portable File**: A `.mdk` file is an inspectable ZIP container holding documents, metadata, and an SQLite index.
- 🔍 **Embedded SQLite Search**: Pre-built full-text index with heading-level chunking and Okapi BM25 ranking.
- 🤖 **AI-Ready Context Assembly**: Retrieve ranked document sections strictly budgeted to your model's token limit (`maxTokens`).
- ✍️ **Section-Aware Mutations**: Prepend, append, or replace text under specific Markdown headings programmatically.
- 💻 **Native VS Code Extension**: Browse containers, edit documents directly via the virtual `mdk:` filesystem, and search live from a dashboard webview.

---

## Installation

Install the command line tool globally (provides `mdkn` and `mdk` commands):

```bash
npm install -g markdown-knowledge
```

Or add the library to your Node.js / TypeScript project:

```bash
npm install markdown-knowledge
```

---

## CLI Quick Start

Commands can be run using either `mdkn` or the shorthand `mdk`. Every command supports `--json` for machine-readable output.

### 1. Create a Knowledge Container

```bash
# Initialize an empty container
mdkn init handbook.mdk --title "Engineering Handbook"

# View container metadata and search index status
mdkn info handbook.mdk
```

### 2. Add Documents

```bash
# Add a document from an existing file
mdkn add handbook.mdk guides/deploy.md --file ./deploy.md --title "Deploying Services" --tags "ops,k8s"

# Add from inline text or stdin
mdkn add handbook.mdk intro.md --content "# Welcome\nTeam documentation."
echo "# Quickstart" | mdkn add handbook.mdk quickstart.md --stdin
```

### 3. Insert Content into Sections

```bash
# Append content into a specific heading section
mdkn insert handbook.mdk guides/deploy.md \
  --section "Kubernetes" \
  --position end \
  --content "- Run helm test before promoting."

# Positions: start | end | before | after | replace
```

### 4. Build or Refresh Search Index

```bash
# Incrementally update index (only processes new/changed documents)
mdkn index handbook.mdk

# Complete index rebuild
mdkn index handbook.mdk --rebuild

# Tip: Pass '--index' to add or insert commands to update the index in the same write:
mdkn add handbook.mdk faq.md --file ./faq.md --index
```

### 5. Search & AI Context Retrieval

```bash
# Full-text search with BM25 ranking and snippets
mdkn search handbook.mdk "how to roll back helm"

# Output structured JSON for agent tool calls
mdkn search handbook.mdk "rollback" --json

# Assemble a token-budgeted context bundle for an LLM prompt
mdkn retrieve handbook.mdk "how to roll back a helm release" --max-tokens 500

# Retrieve whole documents instead of chunked sections
mdkn retrieve handbook.mdk "database incident response" --expand document
```

---

## Programmatic Library API

```typescript
import { MdkContainer, retrieve, formatRetrieveMarkdown } from "markdown-knowledge";

// 1. Open an existing container
const mdk = await MdkContainer.open("handbook.mdk");

// 2. Read or write documents
mdk.writeDocument("guides/deploy.md", markdownText, {
  title: "Deploying Services",
  tags: ["ops"],
});

// 3. Section-aware insertion
mdk.insertContent("guides/deploy.md", "Canary releases use Argo.", {
  section: "Kubernetes",
  position: "end",
});

// 4. Incremental SQLite indexing
const index = await mdk.getIndex();
index.update();

// 5. Search & AI context retrieval
const hits = index.search("helm rollback", { limit: 5 });
const bundle = await retrieve(mdk, "how do I rollback", { maxTokens: 1000 });

// Format as prompt-ready Markdown context
console.log(formatRetrieveMarkdown(bundle));

// 6. Save back to .mdk atomically
await mdk.save();
```

---

## VS Code Extension (`mdk-vscode`)

The companion VS Code extension allows you to browse and edit `.mdk` files without extracting them:

1. **Virtual FileSystem (`mdk:`)**: Open, edit, and save Markdown documents inside `.mdk` containers directly in VS Code. Saving writes atomically back to the container and incrementally updates the SQLite index.
2. **Container Explorer**: View all `.mdk` files in your workspace in the dedicated Activity Bar view with document outlines and folder structures.
3. **Interactive Dashboard**: Opening any `*.mdk` file launches a custom editor dashboard with container metrics, index status, and a **live full-text search** bar.

To package and install locally:
```bash
cd packages/vscode-extension
npm run package
code --install-extension mdk-vscode-0.1.0.vsix
```

---

## Repository Structure

```
markdown-knowledge/
├── packages/
│   ├── mdkn/                # Unified npm package (CLI + programmatic library)
│   └── vscode-extension/    # VS Code extension for browsing & editing .mdk files
├── examples/                # Example documents and test containers
├── LICENSE                  # MIT License
└── README.md
```

---

## Contributing & Development

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run unit tests
npm test
```

---

## License

[MIT](LICENSE) © Markdown Knowledge
