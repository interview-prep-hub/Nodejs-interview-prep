// Measuring event loop delay with perf_hooks
// Shows: monitorEventLoopDelay() and eventLoopUtilization() tell you how healthy the loop is.
// Run: node lessons/08-event-loop/examples/09-measure-loop-delay.js

const { monitorEventLoopDelay, performance } = require('node:perf_hooks');

const RESOLUTION = 10; // the histogram samples the loop with a timer every 10 ms
const histogram = monitorEventLoopDelay({ resolution: RESOLUTION });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ms = (nanoseconds) => (nanoseconds / 1e6).toFixed(0).padStart(3);

function busy(milliseconds) {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) {
    // busy
  }
}

// Runs a phase and prints what the histogram and the utilization saw.
async function phase(label, work) {
  histogram.reset();
  const before = performance.eventLoopUtilization();
  await work();
  const used = performance.eventLoopUtilization(before);
  console.log(
    `${label.padEnd(26)} typical gap ${ms(histogram.percentile(50))} ms | ` +
      `worst gap ${ms(histogram.max)} ms | loop busy ${(used.utilization * 100).toFixed(0).padStart(3)}%`,
  );
}

async function main() {
  histogram.enable();
  console.log(`The histogram timer ticks every ${RESOLUTION} ms. Small, steady gaps mean a healthy loop.`);
  console.log('(Windows timers are coarse, so a healthy gap there can be 10 to 16 ms.)\n');

  await phase('idle loop (sleeping)', () => sleep(300));

  await phase('three 100 ms CPU blocks', async () => {
    for (let i = 0; i < 3; i++) {
      busy(100);
      await sleep(20); // let the loop breathe so the histogram records the gap
    }
  });

  await phase('idle again', () => sleep(300));

  histogram.disable();
}

main();
