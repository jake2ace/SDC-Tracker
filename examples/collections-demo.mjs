import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { createCollectionsService } from '../src/collections/service.mjs';
import { createDeepSeekGenerator } from '../src/collections/deepseek.mjs';

// CLI-only store: all writes share a queue; no files/database are changed.
function createMemoryStore(initialState) {
  let state = structuredClone(initialState);
  let queue = Promise.resolve();
  return {
    read: () => queue.then(() => structuredClone(state)),
    transaction(fn) {
      const work = queue.then(() => {
        const draft = structuredClone(state);
        const result = fn(draft);
        if (result && typeof result.then === 'function') {
          Promise.resolve(result).catch(() => {});
          throw new TypeError('Transaction callbacks must be synchronous');
        }
        const output = structuredClone(result);
        state = structuredClone(draft);
        return output;
      });
      queue = work.then(() => undefined, () => undefined);
      return work;
    },
  };
}

async function main() {
  if (!process.env.DEEPSEEK_API_KEY?.trim()) {
    console.error('请先在本地 .env 填写 DEEPSEEK_API_KEY，再运行此命令。');
    process.exitCode = 1;
    return;
  }

  const seed = JSON.parse(await readFile(new URL('../data/demo.json', import.meta.url), 'utf8'));
  const invoice = seed.invoices.find(row => row.id === 'inv_bd_1');
  const finance = seed.users.find(row => row.companyId === invoice.companyId && row.role === 'finance');
  seed.settings.companyId = finance.companyId;
  seed.settings.userId = finance.id;
  const store = createMemoryStore(seed);
  const service = createCollectionsService({
    store,
    generator: createDeepSeekGenerator(),
    now: () => new Date(`${seed.settings.demoDate}T12:00:00+08:00`),
  });

  console.log('Issue #4｜Rantau 合成数据；仅内存演示，关闭后不保存。');
  console.log('现在向 DeepSeek 请求 1 次话术选择，本地组装催收草稿；不会向客户发送邮件。');
  const result = await service.generateReminder(finance.id, invoice.id);
  if (result.status >= 400) {
    console.error(`生成失败（${result.status}）：${result.body.error.message}`);
    process.exitCode = 1;
    return;
  }
  const reminder = result.body.reminder;
  console.log(`\n主题：${reminder.subject}\n\n${reminder.body}\n`);
  console.log('请核对金额、到期日、逾期天数和语气，再决定是否模拟发送。');
  if (!input.isTTY) {
    console.log('非交互环境：保留草稿，不发送。');
    return;
  }
  const terminal = createInterface({ input, output });
  let answer;
  try {
    answer = await terminal.question('输入 SEND 模拟发送；直接回车结束：');
  } finally {
    terminal.close();
  }
  if (answer.trim() !== 'SEND') {
    console.log('已结束，未发送。');
    return;
  }
  const sent = await service.sendReminder(finance.id, reminder.id);
  if (sent.status >= 400) {
    console.error(`模拟发送失败（${sent.status}）：${sent.body.error.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`模拟发送完成：${sent.body.outbox.requestId}，simulation=${sent.body.outbox.simulation}。`);
}

main().catch(() => {
  // Do not print raw SDK/network errors, request headers, or credentials.
  console.error('演示未完成，请检查本地配置和服务状态后手动重试。');
  process.exitCode = 1;
});
