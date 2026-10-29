export const sourceRepository = 'https://github.com/furkanmeclis/itsaplan-mobile';

export function sourceRevision(value: unknown): string | null {
  return typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value) ? value.toLowerCase() : null;
}

export function sourceLinks(value: unknown) {
  const revision = sourceRevision(value);
  const ref = revision ?? 'main';
  return { revision, repository: revision ? `${sourceRepository}/tree/${revision}` : sourceRepository,
    archive: revision ? `${sourceRepository}/archive/${revision}.tar.gz` : null,
    license: `${sourceRepository}/blob/${ref}/LICENSE`,
    information: `${sourceRepository}/blob/${ref}/docs/open-source.md` };
}
