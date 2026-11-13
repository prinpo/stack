import { readFile, stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { z } from "zod";

const metadataSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  type: z.enum(["index", "reference", "pattern", "workflow"]),
  topics: z.array(z.string().min(1)).min(1),
  related: z.object({ title: z.string().min(1), links: z.array(z.string().min(1)) }),
});

function withoutCode(markdown: string) {
  return markdown.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, "");
}

function headingIds(markdown: string) {
  const ids = new Set<string>();
  for (const match of withoutCode(markdown).matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const base = match[1]!
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_\-\s]/gu, "")
      .replace(/\s/g, "-");
    let id = base;
    for (let suffix = 1; ids.has(id); suffix++) id = `${base}-${suffix}`;
    ids.add(id);
  }
  return ids;
}

/** Check the documentation consumers actually receive, after tarball installation. */
async function validateDocumentation(packageRoot: string) {
  const manifest = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
  const files: string[] = manifest.files.filter((file: string) => file.startsWith("docs/"));
  if (!files.includes("docs/README.md") || !files.includes("docs/capabilities.md"))
    throw new Error(
      "Installed package must declare its documentation entry point and capability map",
    );

  for await (const file of new Bun.Glob("**/*").scan({ cwd: resolve(packageRoot, "docs") })) {
    if (!files.includes(`docs/${file}`))
      throw new Error(`Unexpected non-consumer documentation in installed package: docs/${file}`);
  }

  for (const file of [...files, "README.md"]) {
    const path = resolve(packageRoot, file);
    const markdown = await readFile(path, "utf8");
    const links: string[] = [];
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
    if (!frontmatter) throw new Error(`Missing YAML metadata in ${file}`);
    const metadata = metadataSchema.parse(Bun.YAML.parse(frontmatter[1]!));
    links.push(...metadata.related.links);
    const body = markdown.slice(frontmatter[0].length);
    for (const match of withoutCode(body).matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
      links.push(match[1]!);
    }
    for (const link of links) {
      if (/^(?:https?:|mailto:)/.test(link)) continue;
      const [destination, fragment] = link.split("#");
      const target = resolve(dirname(path), decodeURIComponent(destination!));
      const local = relative(packageRoot, target);
      if (local === ".." || local.startsWith(`..${sep}`) || destination!.startsWith("/"))
        throw new Error(`Documentation link escapes the installed package: ${file} -> ${link}`);
      if (!(await stat(target).catch(() => undefined))?.isFile())
        throw new Error(`Broken installed documentation link: ${file} -> ${link}`);
      if (fragment && !headingIds(await readFile(target, "utf8")).has(decodeURIComponent(fragment)))
        throw new Error(`Broken documentation heading link: ${file} -> ${link}`);
    }
  }
}

if (import.meta.main) await validateDocumentation(resolve(process.argv[2]!));
