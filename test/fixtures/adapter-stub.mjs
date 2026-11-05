/** 只为验证「命令行传的 --adapter 到底有没有被用上」。被加载即抛错。 */
export function createAdapter() {
  throw new Error('STUB_ADAPTER_USED');
}
