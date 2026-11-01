const repository = "prinpo/stack";

export async function github<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.GH_TOKEN ?? ""}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok)
    throw new Error(`GitHub ${method} ${path}: ${response.status} ${await response.text()}`);
  return response.json();
}

export interface GitHubRelease {
  id: number;
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  html_url: string;
  assets: { name: string; browser_download_url: string }[];
}

export async function releases() {
  const result: GitHubRelease[] = [];
  for (let page = 1; ; page++) {
    const batch = await github<GitHubRelease[]>(`releases?per_page=100&page=${page}`);
    result.push(...batch);
    if (batch.length < 100) return result;
  }
}

export interface RegistryPackage {
  versions: Record<string, { dist: { integrity: string } }>;
  "dist-tags": Record<string, string>;
}

export async function registryPackage(): Promise<RegistryPackage> {
  const response = await fetch("https://registry.npmjs.org/@prinpo%2fstack", {
    headers: { "Cache-Control": "no-cache" },
  });
  if (response.status === 404) return { versions: {}, "dist-tags": {} };
  if (!response.ok) throw new Error(`npm registry lookup failed: ${response.status}`);
  return response.json();
}
