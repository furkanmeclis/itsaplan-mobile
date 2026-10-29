import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sourceLinks } from '../src/domain/source';

test('CI source and license URLs are immutable and share the exact validated revision', () => {
  const revision = 'a'.repeat(40);
  const links = sourceLinks(revision.toUpperCase());
  assert.equal(links.revision, revision);
  assert.ok(links.repository.endsWith(`/tree/${revision}`));
  assert.ok(links.archive?.endsWith(`/archive/${revision}.tar.gz`));
  assert.ok(links.license.includes(`/blob/${revision}/`));
  assert.ok(links.information.includes(`/blob/${revision}/`));
});

test('local/invalid source values never become URLs or pretend to match the binary', () => {
  for (const value of [undefined, null, '', 'main', 'https://other.invalid/?credential=fixture', '../invalid', { revision: 'a'.repeat(40) }]) {
    const links = sourceLinks(value);
    assert.equal(links.revision, null);
    assert.equal(links.archive, null);
    assert.equal(links.repository, 'https://github.com/furkanmeclis/itsaplan-mobile');
  }
});
