import * as fs from 'fs';
import * as path from 'path';
import { vi } from 'vitest';
import type { eventWithTime } from '@rrweb/types';
import type * as rrweb from '../../src';
import { launchPuppeteer } from '../utils';

describe('mutation traversal', () => {
  vi.setConfig({ testTimeout: 30_000 });
  let browser: Awaited<ReturnType<typeof launchPuppeteer>>;
  const bundle = fs.readFileSync(
    path.resolve(__dirname, '../../dist/rrweb.umd.cjs'),
    'utf8',
  );

  beforeAll(async () => {
    browser = await launchPuppeteer();
  });
  afterAll(async () => {
    await browser.close();
  });

  it.each(['parent', 'siblings', 'move', 'ignored'] as const)(
    'records and replays each batch when traversal selects a different %s',
    async (scenario) => {
      const page = await browser.newPage();
      try {
        await page.setContent('<main id="app"></main>');
        await page.addScriptTag({ content: bundle });
        const result = await page.evaluate(async (scenario) => {
          const api = (window as Window & { rrweb: typeof rrweb }).rrweb;
          const app = document.getElementById('app')!;
          const events: eventWithTime[] = [];
          const stop = api.record({
            emit: (event) => events.push(event),
            slimDOMOptions: { comment: true },
          });
          const checkpoints: Array<{ time: number; html: string }> = [];
          const checkpoint = async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
            checkpoints.push({
              time: Date.now(),
              // Comments are deliberately omitted by slimDOMOptions.
              html: app.innerHTML.replace('<!--ignored-->', ''),
            });
            await new Promise((resolve) => setTimeout(resolve, 20));
          };
          const parent = document.createElement('div');
          parent.id = 'parent';
          const child = document.createElement('span');
          child.id = 'child';
          child.textContent = 'first';
          if (scenario === 'parent') {
            app.append(child);
            parent.append(child);
            app.append(parent);
          } else if (scenario === 'siblings') {
            app.append(parent);
            parent.append(child);
            const last = document.createElement('b');
            last.id = 'last';
            parent.append(last);
            const middle = document.createElement('i');
            middle.id = 'middle';
            parent.insertBefore(middle, last);
          } else if (scenario === 'move') {
            app.append(parent);
            for (let i = 0; i < 20; i++) {
              const node = document.createElement('span');
              node.textContent = String(i);
              parent.append(node);
            }
            const container = document.createElement('section');
            container.append(parent);
            app.append(container);
            parent.append(child);
          } else {
            app.append(parent);
            const ignored = document.createComment('ignored');
            parent.append(child, ignored);
            const last = document.createElement('b');
            last.id = 'last';
            parent.append(last);
          }
          await checkpoint();
          child.textContent = 'second';
          app.prepend(child);
          const removed = document.createElement('em');
          parent.append(removed);
          removed.remove();
          await checkpoint();
          stop?.();
          const root = document.createElement('div');
          document.body.append(root);
          const player = new api.Replayer(events, {
            root,
            showWarning: false,
          });
          const replayed = checkpoints.map(({ time }) => {
            player.pause(time - events[0].timestamp);
            return player.iframe.contentDocument!.getElementById('app')!
              .innerHTML;
          });
          player.destroy();
          return {
            expected: checkpoints.map(({ html }) => html),
            replayed,
          };
        }, scenario);
        expect(result.replayed).toEqual(result.expected);
        expect(result.expected[0]).toContain('first');
        expect(result.expected[1]).toContain('second');
      } finally {
        await page.close();
      }
    },
  );
});
