// A project saved by a newer Kadr, opened by an older one (V-239: after a rollback of the site, or in a tab that has not
// updated yet). Its fields from the newer format would be dropped by the next save, so it is refused, not migrated down.
import { describe, expect, it } from 'vitest';
import { createProject } from './defaults';
import { ProjectTooNew, migrateProject } from './migrate';
import { SCHEMA_VERSION, type Project } from './types';

describe('a project from a newer version (V-239)', () => {
  it('is refused with words a person can act on, and is left as it was', () => {
    const p = { ...createProject('Newer', '9:16'), version: SCHEMA_VERSION + 1, futureField: { kept: true } } as Project & { futureField: unknown };
    const before = JSON.stringify(p);
    expect(() => migrateProject(p)).toThrow(ProjectTooNew);
    expect(JSON.stringify(p), 'nothing is changed, the version least of all').toBe(before);
  });

  it('a project of this version or an earlier one still opens', () => {
    for (const version of [undefined, 1, SCHEMA_VERSION]) {
      const p = { ...createProject('Old', '9:16'), version } as unknown as Project;
      expect(() => migrateProject(p)).not.toThrow();
      expect(p.version).toBe(SCHEMA_VERSION);
    }
  });
});
