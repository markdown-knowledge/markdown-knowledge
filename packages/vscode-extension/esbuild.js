const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const isWatch = process.argv.includes("--watch");

async function build() {
  fs.mkdirSync(path.join(__dirname, "dist"), { recursive: true });

  // Copy sql-wasm.wasm to dist/
  const wasmSource = path.resolve(__dirname, "../../node_modules/sql.js/dist/sql-wasm.wasm");
  const wasmDest = path.join(__dirname, "dist/sql-wasm.wasm");
  if (fs.existsSync(wasmSource)) {
    fs.copyFileSync(wasmSource, wasmDest);
    console.log("Copied sql-wasm.wasm to dist/");
  }

  const ctx = await esbuild.context({
    entryPoints: [path.join(__dirname, "src/extension.ts")],
    bundle: true,
    outfile: path.join(__dirname, "dist/extension.js"),
    external: ["vscode"],
    format: "cjs",
    platform: "node",
    target: "node18",
    sourcemap: true,
    minify: false,
    logLevel: "info",
  });

  if (isWatch) {
    await ctx.watch();
    console.log("Watching for changes...");
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
