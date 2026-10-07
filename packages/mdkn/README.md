# mdkn

**Markdown Knowledge (`.mdk`)** — single-file Markdown container with built-in SQLite full-text search for AI agents and humans.

- Single portable `.mdk` (ZIP) container holding many Markdown documents.
- Fast FTS search index with BM25 ranking and heading breadcrumbs.
- Token-budgeted context assembly for LLM prompts (`retrieve`).
- CLI tool and Node.js programmatic API in one package.

## Installation

```bash
# Install CLI globally
npm install -g mdkn

# Or add to project
npm install mdkn
```

## CLI Usage

Commands can be invoked with either `mdkn` or `mdk`:

```bash
# Initialize a container
mdkn init knowledge.mdk --title "Team Knowledge"

# Add a document
mdkn add knowledge.mdk guides/deploy.md --file ./README.md

# Insert content into a specific section
mdkn insert knowledge.mdk guides/deploy.md --section "Kubernetes" --content "Canary deployments use Argo."

# Index container with SQLite FTS
mdkn index knowledge.mdk

# Full-text search (BM25 ranked)
mdkn search knowledge.mdk "how to deploy" --json

# AI context retrieval (token-budgeted for LLMs)
mdkn retrieve knowledge.mdk "how to deploy" --max-tokens 500
```

## JavaScript / TypeScript API

```typescript
import { MdkContainer, retrieve, formatRetrieveMarkdown } from "mdkn";

// Open container
const mdk = await MdkContainer.open("knowledge.mdk");

// Add / edit documents
mdk.writeDocument("guides/deploy.md", "# Deploying\n...");

// Incremental SQLite indexing
const index = await mdk.getIndex();
index.update();

// Search & AI retrieval
const hits = index.search("deploy");
const bundle = await retrieve(mdk, "how to deploy", { maxTokens: 1000 });
console.log(formatRetrieveMarkdown(bundle));

// Save container atomically
await mdk.save();
```

## License

MIT
