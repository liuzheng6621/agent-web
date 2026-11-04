/**
 * 变异体的加载层。清单本体在 docs/mutants/ —— 那才是要被人审的东西。
 * 这里只负责：查 id、包一层、给 CLI 用的描述。
 */
import { mutants, mutantIds, mutantById } from '../docs/mutants/index.mjs';

export const MUTATIONS = mutants;

export function mutate(adapter, id) {
  const m = mutantById(id);
  if (!m) throw new Error(`unknown mutation: ${id}（可用：${mutantIds.join(', ')}）`);
  return m.wrap(adapter);
}

export function mutationIds() {
  return [...mutantIds];
}

export function describeMutations() {
  return MUTATIONS.map((m) => ({
    id: m.id,
    title: m.title,
    layer: m.layer,
    symptom: m.symptom,
    mechanism: m.mechanism,
    catch_hint: m.catch_hint,
  }));
}

export { validateMutants } from '../docs/mutants/index.mjs';
