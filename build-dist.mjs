import { promises as fs } from "fs";
import path from "path";
import { minify as minifyHtml } from "html-minifier-terser";
import { minify as minifyJs } from "terser";
import CleanCSS from "clean-css";

const root = process.cwd();
const srcHtmlPath = path.join(root, "index.html");
const distDir = path.join(root, "dist");
const distJsDir = path.join(distDir, "js");
const srcImgDir = path.join(root, "img");
const distImgDir = path.join(distDir, "img");

async function ensureCleanDist() {
  await fs.rm(distDir, { recursive: true, force: true });
  await fs.mkdir(distJsDir, { recursive: true });
}

async function copyDirectoryRecursive(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirectoryRecursive(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

function minifyInlineStyles(html) {
  return html.replace(/<style>([\s\S]*?)<\/style>/g, (_, cssCode) => {
    const minified = new CleanCSS({ level: 2 }).minify(cssCode);
    const finalCss = minified.styles || cssCode;
    return `<style>${finalCss}</style>`;
  });
}

async function minifyAndExtractInlineScripts(html) {
  const scriptRegex = /<script>([\s\S]*?)<\/script>/g;
  const matches = [...html.matchAll(scriptRegex)];
  let transformed = html;

  let appMinified = null;
  let tailwindConfigMinified = null;

  for (const match of matches) {
    const fullScriptTag = match[0];
    const scriptContent = (match[1] || "").trim();

    if (!scriptContent) continue;

    const isHotjar = /h\._hjSettings|static\.hotjar\.com/.test(scriptContent);
    if (isHotjar) {
      continue;
    }

    if (/tailwind\.config\s*=/.test(scriptContent)) {
      const result = await minifyJs(scriptContent, {
        compress: true,
        mangle: true,
      });
      tailwindConfigMinified = result.code || scriptContent;
      transformed = transformed.replace(
        fullScriptTag,
        '<script src="js/tailwind-config.min.js"></script>'
      );
      continue;
    }

    if (/DOMContentLoaded|fetch\(|URLSearchParams|mask-telefone/.test(scriptContent)) {
      const result = await minifyJs(scriptContent, {
        compress: true,
        mangle: true,
      });
      appMinified = result.code || scriptContent;
      transformed = transformed.replace(fullScriptTag, '<script src="js/app.min.js"></script>');
      continue;
    }
  }

  if (tailwindConfigMinified) {
    await fs.writeFile(path.join(distJsDir, "tailwind-config.min.js"), tailwindConfigMinified, "utf8");
  }
  if (appMinified) {
    await fs.writeFile(path.join(distJsDir, "app.min.js"), appMinified, "utf8");
  }

  return transformed;
}

async function build() {
  const htmlRaw = await fs.readFile(srcHtmlPath, "utf8");

  await ensureCleanDist();

  let html = htmlRaw;
  html = minifyInlineStyles(html);
  html = await minifyAndExtractInlineScripts(html);

  const htmlMinified = await minifyHtml(html, {
    collapseWhitespace: true,
    removeComments: true,
    removeRedundantAttributes: true,
    removeEmptyAttributes: false,
    minifyCSS: false,
    minifyJS: false,
    keepClosingSlash: true,
    ignoreCustomFragments: [/<%[\s\S]*?%>/, /<\?[\s\S]*?\?>/],
  });

  await fs.writeFile(path.join(distDir, "index.html"), htmlMinified, "utf8");

  try {
    await copyDirectoryRecursive(srcImgDir, distImgDir);
  } catch (error) {
    if (error && error.code !== "ENOENT") throw error;
  }

  console.log("Build concluido com sucesso em dist/.");
}

build().catch((error) => {
  console.error("Falha no build:", error);
  process.exit(1);
});
