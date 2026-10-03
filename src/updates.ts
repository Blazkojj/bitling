// Once a day, asks GitHub whether a newer Bitling release exists. Nothing is
// downloaded or installed automatically: the menu just offers the release page.

const LATEST = "https://api.github.com/repos/Blazkojj/bitling/releases/latest";

export interface Release {
  version: string;
  url: string;
}

/** Compares "1.2.10" > "1.2.9" numerically; a leading "v" is ignored. */
export function isNewer(candidate: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
  const [a, b] = [parse(candidate), parse(current)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

export async function checkForUpdate(current: string): Promise<Release | null> {
  try {
    const res = await fetch(LATEST, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) return null;
    const release = (await res.json()) as { tag_name?: string; html_url?: string; draft?: boolean };
    if (!release.tag_name || !release.html_url || release.draft) return null;
    return isNewer(release.tag_name, current) ? { version: release.tag_name, url: release.html_url } : null;
  } catch {
    return null; // offline: try again tomorrow
  }
}
