/**
 * Ingestion load check (task 6.12).
 *
 * The design's scale envelope is ~100,000 automated results per day. A day's volume does
 * not arrive evenly: it arrives as CI jobs finishing, so this drives it as realistic
 * report-sized uploads and measures both per-upload latency and resulting database growth.
 */
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = process.env.TCMS_URL ?? 'http://127.0.0.1:8080';
const PROJECT_ID = process.env.PROJECT_ID;
const TOKEN = process.env.TCMS_TOKEN;
const TOTAL = Number(process.env.TOTAL_RESULTS ?? 100_000);
const PER_REPORT = Number(process.env.PER_REPORT ?? 500);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 4);

if (!PROJECT_ID || !TOKEN) throw new Error('PROJECT_ID and TCMS_TOKEN are required');

/** A report of `count` tests, ~8% failing, bound by declared case id where possible. */
function buildReport(reportIndex, count) {
  const cases = [];
  for (let i = 0; i < count; i++) {
    const n = reportIndex * count + i;
    const name = `test_generated_${n}`;
    const failing = n % 12 === 0;
    const ref = `EXA-${1000 + (n % 2000)}`;
    cases.push(
      `<testcase classname="tests.load.mod${n % 50}" name="${name}" time="${(n % 300) / 100}">` +
        `<properties><property name="tcms.id" value="${ref}"/></properties>` +
        (failing
          ? `<failure message="AssertionError: expected 200 but got 5${n % 10}3">stack ${n}</failure>`
          : '') +
        `</testcase>`,
    );
  }
  return `<?xml version="1.0" encoding="utf-8"?><testsuites name="load"><testsuite name="load" tests="${count}">${cases.join('')}</testsuite></testsuites>`;
}

const reportCount = Math.ceil(TOTAL / PER_REPORT);
console.log(
  `Driving ${TOTAL.toLocaleString()} results as ${reportCount} reports of ${PER_REPORT}, concurrency ${CONCURRENCY}`,
);

const latencies = [];
let ingested = 0;
let failed = 0;
const started = Date.now();

let next = 0;
async function worker() {
  for (;;) {
    const index = next++;
    if (index >= reportCount) return;
    const xml = buildReport(index, PER_REPORT);
    const t0 = Date.now();
    const response = await fetch(
      `${BASE}/api/projects/${PROJECT_ID}/results/junit?release=load-test&environment=ci&branch=main&commitSha=load${index}`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/xml' },
        body: xml,
      },
    );
    const ms = Date.now() - t0;
    if (!response.ok) {
      failed++;
      if (failed <= 3) console.error(`  upload ${index} failed: ${response.status} ${await response.text()}`);
    } else {
      const body = await response.json();
      ingested += body.ingested;
      latencies.push(ms);
    }
    if (latencies.length % 25 === 0 && latencies.length > 0) {
      process.stdout.write(`  ${ingested.toLocaleString()} results...\r`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
await sleep(200);

const elapsed = (Date.now() - started) / 1000;
latencies.sort((a, b) => a - b);
const pct = (p) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))];

console.log(`\n
  uploads          ${latencies.length} ok, ${failed} failed
  results ingested ${ingested.toLocaleString()}
  wall time        ${elapsed.toFixed(1)}s
  throughput       ${Math.round(ingested / elapsed).toLocaleString()} results/second
  a full day       ${(TOTAL / (ingested / elapsed) / 60).toFixed(1)} minutes of ingest for ${TOTAL.toLocaleString()} results

  per-upload latency for ${PER_REPORT} results
    p50            ${pct(0.5)}ms
    p95            ${pct(0.95)}ms
    p99            ${pct(0.99)}ms
    max            ${latencies.at(-1)}ms
`);

process.exit(failed === 0 ? 0 : 1);
