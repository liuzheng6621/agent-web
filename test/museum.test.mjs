/**
 * 展品自检。
 *
 * 这个文件存在的理由只有一个：展品会腐烂。
 * 一旦某个机制被改掉、被静默删掉、或者断言被放宽，
 * 展品必须立刻变红——否则 docs/museum 就只是一堆好看的散文。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { exhibits } from '../docs/museum/index.mjs';

test('展品库：每件都能自己跑，且确实被它声称的机制抓住', async (t) => {
  assert.ok(exhibits.length >= 6, '展品少于 6 件');

  const ids = new Set();
  for (const m of exhibits) {
    await t.test(`${m.meta.id} ${m.meta.title}`, async () => {
      assert.ok(!ids.has(m.meta.id), `展品 id 重复：${m.meta.id}`);
      ids.add(m.meta.id);

      for (const k of ['symptom', 'mechanism', 'caught', 'caughtCode']) {
        assert.ok(m.meta[k], `${m.meta.id} 缺 ${k}`);
      }

      const r = await m.run();
      assert.ok(r && r.caught, `${m.meta.id} run() 没有返回 caught`);

      assert.equal(r.caught.status, m.meta.caught, `${m.meta.id} 判决与文档不符`);
      assert.equal(r.caught.reason_code, m.meta.caughtCode, `${m.meta.id} 理由码与文档不符`);

      // 抓不住就不叫展品。
      assert.notEqual(r.caught.status, 'pass', `${m.meta.id} 在机制下仍然判 pass`);

      // 没有机制时的样子也必须对得上，否则这份文档是在编故事。
      if (m.meta.naive === 'pass') {
        assert.ok(r.naive, `${m.meta.id} 声称无机制时会 pass，却没有复现出来`);
        assert.equal(r.naive.status, 'pass', `${m.meta.id} 的 naive 判决不是 pass`);
      }

      // 靠对照抓的那种，必须真的不一致。
      if (r.disagreement !== undefined) {
        assert.equal(r.disagreement, true, `${m.meta.id} 两边判决一致，等于什么也没抓到`);
      }
    });
  }
});
