// One copy of each package in the bundle (registry S-1-11). A package reached by two paths — a node_modules that is a
// symlink, as in a session's git worktree, next to its real path — is bundled twice. For React that is two hook
// dispatchers: the build passes and the page is blank ("Cannot read properties of null (reading 'useState')"). The
// build fails here instead, naming the package and both folders.

/** Packages whose modules come from more than one folder, with those folders (`node_modules/<name>` paths). */
export function duplicatePackages(moduleIds: Iterable<string>): Map<string, string[]> {
  const dirs = new Map<string, Set<string>>();
  for (const id of moduleIds) {
    // The last node_modules in the path is the package itself (a dependency nested in another package counts as its own).
    const at = id.lastIndexOf('node_modules');
    if (at < 0 || id.startsWith('\0')) continue;
    const tail = id.slice(at).match(/^node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/);
    if (!tail) continue;
    const name = tail[1].replace(/\\/g, '/');
    const dir = id.slice(0, at) + 'node_modules/' + name;
    (dirs.get(name) ?? dirs.set(name, new Set()).get(name)!).add(dir);
  }
  return new Map([...dirs].filter(([, d]) => d.size > 1).map(([n, d]) => [n, [...d].sort()]));
}

/** Fails the build when a package is bundled from two folders. */
export const oneCopyPlugin = {
  name: 'kadr-one-copy',
  apply: 'build' as const,
  generateBundle(_options: unknown, bundle: Record<string, { type: string; moduleIds?: string[] }>) {
    const ids = Object.values(bundle).flatMap((c) => (c.type === 'chunk' ? c.moduleIds ?? [] : []));
    const twice = duplicatePackages(ids);
    if (twice.size) {
      const list = [...twice].map(([n, d]) => `${n}: ${d.join(' and ')}`).join('; ');
      throw new Error(`The bundle has two copies of a package (scripts/one-copy.ts): ${list}. Usually node_modules is reached through a symlink and its real path at once; add the package to resolve.dedupe in vite.config.ts.`);
    }
  },
};
