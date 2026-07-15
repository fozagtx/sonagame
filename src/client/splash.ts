import { context, requestExpandedMode } from '@devvit/web/client';

const start = document.getElementById('start-button') as HTMLButtonElement;
const desc = document.getElementById('description') as HTMLParagraphElement;
const hook = document.getElementById('hook-line') as HTMLParagraphElement;

const name = context.username?.trim();
desc.textContent = name
  ? `${name} — spin the shaft, drop the core.`
  : 'Spin the shaft. Drop the core. Don’t kiss the red.';

hook.textContent = 'Same Daily Core for everyone until UTC midnight. Keep the streak.';

start.addEventListener('click', (e) => {
  requestExpandedMode(e, 'game');
});
