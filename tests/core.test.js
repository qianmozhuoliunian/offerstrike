import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSource, filterByDate, normalizeAnswer } from '../src/core.js';

test('rejects source links that are not HTTP or HTTPS', () => {
  assert.throws(() => validateSource({ title: '面经', url: 'javascript:alert(1)' }), /链接/);
});
test('date filter excludes unknown dates and old dates', () => {
  const items = [{ date: '2026-08-01' }, { date: '2024-01-01' }, { date: '' }];
  assert.equal(filterByDate(items, '2026-01-01').length, 1);
});
test('rejects empty answers', () => {
  assert.throws(() => normalizeAnswer('  '), /回答/);
});
