import fs from 'node:fs/promises';

const [, , mode = 'complete', output = 'audit/codex-implementation.png'] = process.argv;
const width = mode === 'mobile' ? 390 : 1440;
const height = mode === 'mobile' ? 844 : 1000;
const pages = await fetch('http://127.0.0.1:9223/json').then(response => response.json());
const page = pages.find(item => item.type === 'page');

if (!page) throw new Error('No Chrome page is available on port 9223.');

const socket = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
const browserErrors = [];
let sequence = 0;

socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails?.text || 'Runtime exception');
  if (message.method === 'Log.entryAdded' && ['error', 'warning'].includes(message.params.entry?.level)) browserErrors.push(message.params.entry.text);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Evaluation failed');
  return result.result.value;
};
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width,
  height,
  deviceScaleFactor: 1,
  mobile: mode === 'mobile',
  screenWidth: width,
  screenHeight: height,
});
await send('Page.navigate', { url: 'http://127.0.0.1:4173/' });
await pause(1000);
await evaluate(`localStorage.setItem('mushsci-onboard-v1', JSON.stringify({skipped:true,at:Date.now()})); localStorage.removeItem('mushsci-workspace-v2'); location.reload();`);
await pause(1000);
await evaluate(`document.querySelector('.recent-task')?.click()`);
await pause(500);

if (mode === 'running' || mode === 'stopped') {
  await evaluate(`(() => {
    const input = document.querySelector('.composer-dock textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(input, '请协调论文检索与材料科学专家，核对当前研究方向并给出结论');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await pause(100);
  await evaluate(`document.querySelector('.composer-dock .round-btn.send')?.click()`);
  await pause(mode === 'stopped' ? 1200 : 2400);
  if (mode === 'stopped') {
    await evaluate(`document.querySelector('.composer-dock .round-btn.send.busy')?.click()`);
    await pause(4500);
    await evaluate(`document.querySelector('.message:last-of-type .codex-run')?.scrollIntoView({block:'center'})`);
  } else {
    await evaluate(`document.querySelector('.running-message')?.scrollIntoView({block:'center'})`);
  }
} else {
  await evaluate(`(() => {
    const target = document.querySelector(${JSON.stringify(mode === 'attention' ? '.codex-run.attention' : '#message-sample-coord-main .codex-run')});
    if (target?.querySelector('.codex-run-head')?.getAttribute('aria-expanded') === 'false') target.querySelector('.codex-run-head').click();
    target?.scrollIntoView({block:'center'});
  })()`);
}
await pause(500);

const full = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
await fs.writeFile(output, Buffer.from(full.data, 'base64'));

const selector = mode === 'running' ? '.running-message .codex-run' : mode === 'stopped' ? '.message:has(.codex-run.stopped) .codex-run' : mode === 'attention' ? '.codex-run.attention' : '#message-sample-coord-main .codex-run';
const rect = await evaluate(`(() => {
  const target = document.querySelector(${JSON.stringify(selector)});
  if (!target) return null;
  const run = target.getBoundingClientRect();
  const header = target.closest('.message')?.querySelector('.message-header')?.getBoundingClientRect();
  const left = Math.max(0, run.left);
  const top = Math.max(0, (header?.top ?? run.top) - 12);
  return {x:left + scrollX,y:top + scrollY,width:Math.min(innerWidth-left,run.width),height:Math.min(innerHeight-top,run.bottom-top+12)};
})()`);

if (rect && mode !== 'mobile') {
  const focused = await send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: true,
    clip: { ...rect, scale: 1 },
  });
  const focusOutput = output.replace(/\.png$/i, '-focus.png');
  await fs.writeFile(focusOutput, Buffer.from(focused.data, 'base64'));
}

const interaction = mode === 'complete' || mode === 'mobile' ? await evaluate(`(async () => {
  const target = document.querySelector(${JSON.stringify(selector)});
  const head = target?.querySelector('.codex-run-head');
  if (!head) return null;
  head.click();
  await new Promise(resolve => setTimeout(resolve, 80));
  const collapsed = !target.querySelector('.codex-run-stream') && head.getAttribute('aria-expanded') === 'false';
  head.click();
  await new Promise(resolve => setTimeout(resolve, 80));
  const reopened = !!target.querySelector('.codex-run-stream') && head.getAttribute('aria-expanded') === 'true';
  const tool = target.querySelector('.codex-tool-summary');
  const beforeTool = tool?.getAttribute('aria-expanded');
  tool?.click();
  await new Promise(resolve => setTimeout(resolve, 80));
  const afterTool = tool?.getAttribute('aria-expanded');
  return {collapsed,reopened,toolDisclosureChanged:!!tool && beforeTool !== afterTool};
})()`) : null;

const diagnostics = await evaluate(`({
  viewport:{width:innerWidth,height:innerHeight},
  horizontalOverflow:document.documentElement.scrollWidth > document.documentElement.clientWidth,
  runCount:document.querySelectorAll('.codex-run').length,
  targetExists:!!document.querySelector(${JSON.stringify(selector)}),
  expanded:document.querySelector(${JSON.stringify(selector + ' .codex-run-head')})?.getAttribute('aria-expanded'),
  busy:!!document.querySelector('.running-message'),
  targetText:document.querySelector(${JSON.stringify(selector)})?.innerText.slice(0,1200)
})`);
console.log(JSON.stringify({...diagnostics,interaction,browserErrors}, null, 2));
socket.close();
