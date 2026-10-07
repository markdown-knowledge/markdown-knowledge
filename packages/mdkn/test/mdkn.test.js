const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const JSZip = require("jszip");
const core = require("../dist");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdk-test-"));
const file = (name) => path.join(tmp, name);

const DEPLOY = `---
title: Deploying
tags: [ops, k8s]
---
# Deploying

Intro text.

## Kubernetes

Use helm to deploy the chart.

\`\`\`bash
# not a heading
helm install app ./chart
\`\`\`

### Rollback

Run helm rollback.

## Docker

Build the image with docker build.
`;

test("markdown: headings ignore code fences, support setext", () => {
  const hs = core.parseHeadings(DEPLOY + "\nSetext Title\n============\n");
  assert.deepEqual(hs.map((h) => [h.level, h.text]), [
    [1, "Deploying"], [2, "Kubernetes"], [3, "Rollback"], [2, "Docker"], [1, "Setext Title"],
  ]);
});

test("markdown: chunk breadcrumbs and line numbers", () => {
  const chunks = core.chunkMarkdown(DEPLOY);
  assert.deepEqual(chunks.map((c) => c.heading), [
    "Deploying", "Deploying > Kubernetes", "Deploying > Kubernetes > Rollback", "Deploying > Docker",
  ]);
  const k8s = chunks[1];
  assert.ok(k8s.content.includes("helm install"));
  assert.equal(DEPLOY.split("\n")[k8s.startLine - 1], "Use helm to deploy the chart.");
});

test("markdown: insert into sections", () => {
  let md = core.insertContent(DEPLOY, "- step A", { section: "Kubernetes", position: "end" });
  const lines = md.split("\n");
  assert.ok(lines.indexOf("- step A") < lines.indexOf("### Rollback"));
  md = core.insertContent(DEPLOY, "## Nomad\n\nAlt scheduler.", { section: "Kubernetes", position: "after" });
  assert.ok(md.indexOf("## Nomad") > md.indexOf("Run helm rollback.") && md.indexOf("## Nomad") < md.indexOf("## Docker"));
  md = core.insertContent(DEPLOY, "Replaced.", { section: "Deploying > Docker", position: "replace" });
  assert.ok(md.trimEnd().endsWith("## Docker\n\nReplaced."));
  md = core.insertContent(DEPLOY, "TOP", { position: "start" });
  assert.equal(core.parseFrontMatter(md).body.trimStart().split("\n")[0], "TOP");
  assert.throws(() => core.insertContent(DEPLOY, "x", { section: "Nope" }), /Section not found/);
});

test("container: create, write, save, reopen, search, retrieve", async () => {
  const f = file("kb.mdk");
  const c = await core.MdkContainer.create(f, { title: "KB" });
  c.writeDocument("guides/deploy", DEPLOY);
  c.writeDocument("notes/cafe.md", "# Café notes\n\nThe espresso machine is in the kitchen.\n", { tags: ["office"] });
  assert.throws(() => c.writeDocument("guides/deploy.md", "x", { noOverwrite: true }), /already exists/);
  const idx = await c.getIndex();
  const stats = idx.update();
  assert.equal(stats.added, 2);
  await c.save();

  // mimetype first and stored
  const buf = fs.readFileSync(f);
  assert.equal(buf.toString("latin1", 30, 38), "mimetype");
  const zip = await JSZip.loadAsync(buf);
  assert.ok(zip.file("index/index.sqlite"));
  assert.ok(zip.file("docs/guides/deploy.md"));

  const c2 = await core.MdkContainer.open(f);
  const d = c2.getDocument("guides/deploy.md");
  assert.equal(d.title, "Deploying");
  assert.deepEqual(d.tags, ["ops", "k8s"]);
  assert.deepEqual(c2.getDocument("notes/cafe").tags, ["office"]);
  const i2 = await c2.getIndex();
  assert.equal(i2.status().fresh, true);

  const hits = i2.search("helm rollback");
  assert.equal(hits[0].heading, "Deploying > Kubernetes > Rollback");
  assert.ok(hits[0].snippet.includes("«"));
  assert.equal(i2.search("cafe")[0].path, "notes/cafe.md", "diacritics folded");
  assert.equal(i2.search("deploy", { tags: ["office"] }).length, 0);
  assert.ok(i2.search("espresso kubernetes").length >= 2, "AND falls back to OR");
  assert.equal(i2.search("heading:docker", { raw: true })[0].heading, "Deploying > Docker");

  const r = await core.retrieve(c2, "helm", { maxTokens: 200 });
  assert.ok(r.tokens <= 200 && r.items.length > 0);
  assert.ok(core.formatRetrieveMarkdown(r).includes("[guides/deploy.md#L"));
});

test("index: incremental update detects stale/missing/orphaned", async () => {
  const f = file("inc.mdk");
  const c = await core.MdkContainer.create(f);
  c.writeDocument("a", "# A\n\nalpha");
  c.writeDocument("b", "# B\n\nbeta");
  const idx = await c.getIndex();
  idx.update();
  c.insertContent("a", "gamma ray", { position: "end" });
  c.deleteDocument("b");
  c.writeDocument("c", "# C\n\ndelta");
  const st = idx.status();
  assert.deepEqual([st.stale, st.missing, st.orphaned], [["a.md"], ["c.md"], ["b.md"]]);
  const s = idx.update();
  assert.deepEqual([s.added, s.updated, s.removed], [1, 1, 1]);
  assert.equal(idx.search("gamma")[0].path, "a.md");
  assert.equal(idx.search("beta").length, 0);
});

test("container: tolerates zips edited with plain tools", async () => {
  const zip = new JSZip();
  zip.file("mimetype", core.MIMETYPE);
  zip.file("manifest.json", JSON.stringify({ format: "mdk", formatVersion: 1, documents: { "gone.md": { id: "x" } } }));
  zip.file("docs/added.md", "# Added by hand\n");
  const f = file("manual.mdk");
  fs.writeFileSync(f, await zip.generateAsync({ type: "nodebuffer" }));
  const c = await core.MdkContainer.open(f);
  assert.deepEqual(c.listDocuments().map((d) => d.path), ["added.md"]);
  assert.equal(c.getDocument("added").title, "Added by hand");
});

test("paths: reject traversal", () => {
  assert.throws(() => core.normalizeDocPath("../evil"), /Invalid/);
  assert.equal(core.normalizeDocPath("\\a\\b"), "a/b.md");
});
