export const e13 = {
  id: 'k-order-not-in-contract',
  title: '把实现自有的约定写成断言，造出一条假的红',
  symptom:
    'shared 案例里写了「订单列表按创建时间升序」，mock 判 pass，真后端判 fail——'
    + '真后端新的在前。两边都没把自己怎么排写进契约。'
    + '这时降级断言、或者去改真后端，两个动作都是错的：前者把判据删掉，后者让被测系统迁就测试。',
  cause:
    '排序、id 偏移、时间戳格式这类东西，看起来是「客观事实」，其实是各实现自己的约定。'
    + '把它们写成跨实现的断言，测到的不是 bug，是两种都合理的实现差异。'
    + '这和 k-unportable-assertion 是同一种病，只是那次发生在建议断言里，这次发生在共享案例里。',
  fix:
    '共享案例不写实现自有的约定；真要测排序就放进单实现的示例案例'
    + '（examples/shape-order/），并在 certify 基线里把它列为不可移植漏网。'
    + '对应的变异体 m-unsorted-orders 保留——它证明 sorted_by 本身有用，只是不该跨实现用。',
  fingerprint: {
    structure: 'case/assertion:implementation-convention',
    witness: 'orders.*.createTime',
    detector: 'certify:m-unsorted-orders',
  },
  first_seen: { commit: '3a20985', date: '2026-11-04' },
  guard: {
    kind: 'certify',
    ref: 'scripts/certify-baseline.mjs 的 KNOWN_SURVIVORS（m-unsorted-orders 记为不可移植）',
  },
  repro:
    'node -e "const c=require(\'./cases/coffee/shape.json\');console.log(c.task.goal_assertions.map(a=>a.kind))" '
    + '&& node bin/agent-web.mjs certify cases/coffee --adapter=memory | tail -4',
};

