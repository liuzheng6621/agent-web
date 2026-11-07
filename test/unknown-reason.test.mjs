// 「判不了」的理由码规则只能有一份。
//
// 它曾经有两处：runner.mjs 走白名单，certify.mjs 的快路径自己写「取第一个 unknown 的 code」。
// 两条规则在现有变异体下恰好结论相同，所以没有任何测试会红 —— 这正是最难发现的那类分叉。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveUnknownReason, SPECIFIC_UNKNOWN_CODES, DEFAULT_UNKNOWN_REASON } from '../src/unknown-reason.mjs';
import { deriveVerdict } from '../src/certify.mjs';

const PASS_BASE = { status: 'pass', reason_code: 'ok' };

test('白名单内的唯一原因会被提上来', () => {
  assert.equal(resolveUnknownReason(['unsupported_event']), 'unsupported_event');
  assert.equal(resolveUnknownReason(['unsupported_event', 'unsupported_event']), 'unsupported_event');
});

test('两个不同原因同时出现，就不许再提 —— 「全都因为同一个原因」这个前提已经不成立', () => {
  assert.equal(resolveUnknownReason(['unsupported_event', 'invalid_case']), DEFAULT_UNKNOWN_REASON);
  assert.equal(resolveUnknownReason(['invalid_case', 'unsupported_event']), DEFAULT_UNKNOWN_REASON);
});

test('白名单外的码一律退回缺省，不许泄漏到 verdict 上', () => {
  assert.equal(resolveUnknownReason(['invalid_case']), DEFAULT_UNKNOWN_REASON);
  assert.equal(resolveUnknownReason(['something_new']), DEFAULT_UNKNOWN_REASON);
  assert.equal(resolveUnknownReason([]), DEFAULT_UNKNOWN_REASON);
  assert.equal(resolveUnknownReason([undefined, null]), DEFAULT_UNKNOWN_REASON);
});

test('快路径与重放路径对同一个理由码规则给出同一个答案', () => {
  const flat = [{ label: 'g0' }, { label: 'g1' }];
  const cases = [
    [[{ status: 'unknown', code: 'unsupported_event' }, { status: 'true', code: 'ok' }], 'unsupported_event'],
    [[{ status: 'unknown', code: 'unsupported_event' }, { status: 'unknown', code: 'invalid_case' }], DEFAULT_UNKNOWN_REASON],
    [[{ status: 'unknown', code: 'invalid_case' }, { status: 'true', code: 'ok' }], DEFAULT_UNKNOWN_REASON],
    [[{ status: 'unknown', code: undefined }, { status: 'true', code: 'ok' }], DEFAULT_UNKNOWN_REASON],
  ];
  for (const [results, want] of cases) {
    assert.equal(deriveVerdict(PASS_BASE, flat, results).reason_code, want);
  }
});

test('结构守卫：理由码规则只许有一份实现', () => {
  // 谁再在别处手写「取第一个 unknown 的 code」或者自带一份白名单，这里会红。
  const files = ['src/runner.mjs', 'src/certify.mjs'];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    assert.ok(
      !/SPECIFIC_UNKNOWN_CODES\s*=\s*new Set/.test(src),
      `${f} 里又出现了一份白名单 —— 规则只能在 src/unknown-reason.mjs`,
    );
    assert.ok(
      !/reason_code:\s*(?:blind|first|r)\.code/.test(src),
      `${f} 里又出现「取第一条 unknown 的 code」—— 那是另一份规则`,
    );
  }
});

test('白名单是封闭的：新增一个可提升的码是规范变更', () => {
  assert.deepEqual([...SPECIFIC_UNKNOWN_CODES], ['unsupported_event']);
});
