/**
 * Reproducible synthetic benchmark harness.
 *
 * Run with `npm run bench` (builds first and enables --expose-gc).
 * Results describe this machine and runtime only; they are not guarantees.
 */

import { writeFileSync } from 'node:fs';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { resolve } from 'node:path';
import { createRecommender } from '../dist/index.js';

const projectRoot = resolve(import.meta.dirname, '..');
const RESULTS_PATH = resolve(projectRoot, 'benchmarks', 'results.json');

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

function makeDataset(count, attributeCount) {
  const random = createRandom(0x5eed_1234);
  const items = new Array(count);
  for (let index = 0; index < count; index += 1) {
    if (attributeCount === 0) {
      items[index] = { id: `item-${index}` };
      continue;
    }
    const attributes = {};
    for (let attribute = 0; attribute < attributeCount; attribute += 1) {
      attributes[`field${attribute}`] = random() < 0.5 ? `value-${attribute}` : attribute;
    }
    items[index] = { id: `item-${index}`, attributes };
  }
  return items;
}

const CONTENT_CATEGORIES = ['space', 'science', 'cooking', 'travel', 'music'];
const CONTENT_TYPES = ['article', 'video', 'podcast'];

function makeContentDataset(count, tagsPerItem) {
  const items = new Array(count);
  for (let index = 0; index < count; index += 1) {
    const tags = new Array(tagsPerItem);
    for (let tag = 0; tag < tagsPerItem; tag += 1) {
      tags[tag] = `tag-${(index + tag) % 32}`;
    }
    items[index] = {
      id: `item-${index}`,
      attributes: {
        category: CONTENT_CATEGORIES[index % CONTENT_CATEGORIES.length],
        tags,
        topics: [`topic-${index % 16}`, `topic-${(index + 1) % 16}`],
        keywords: [`keyword-${index % 24}`, `keyword-${(index + 1) % 24}`],
        contentType: CONTENT_TYPES[index % CONTENT_TYPES.length],
      },
    };
  }
  return items;
}

function makeContentPreferences() {
  return {
    interests: [
      { kind: 'category', value: 'space', weight: 3 },
      { kind: 'tag', value: 'tag-1', weight: 2 },
      { kind: 'tag', value: 'tag-3' },
      { kind: 'topic', value: 'topic-1' },
      { kind: 'keyword', value: 'keyword-1' },
      { kind: 'contentType', value: 'article' },
    ],
  };
}

function makeCollaborativeData(
  itemCount,
  userCount,
  interactionsPerUser,
  targetUserIndex = 0,
  targetInteractionsPerUser = interactionsPerUser,
) {
  const interactions = [];
  const targetId = `user-${targetUserIndex}`;
  // Deterministic target anchors for overlap.
  const targetAnchors = Array.from(
    { length: Math.min(targetInteractionsPerUser, itemCount) },
    (_, i) => `item-${(i * 17) % itemCount}`,
  );
  for (let i = 0; i < targetAnchors.length; i += 1) {
    interactions.push({
      userId: targetId,
      itemId: targetAnchors[i],
      type: 'view',
      value: 1,
    });
  }
  for (let u = 0; u < userCount; u += 1) {
    if (u === targetUserIndex) continue;
    const userId = `user-${u}`;
    for (let i = 0; i < interactionsPerUser; i += 1) {
      // Ensure some overlap with target for stable collaborative benchmarking.
      const itemId =
        i === 0 && targetAnchors.length > 0
          ? targetAnchors[u % targetAnchors.length]
          : `item-${(u * 7 + i * 13) % itemCount}`;
      interactions.push({
        userId,
        itemId,
        type: i % 3 === 0 ? 'like' : 'view',
        value: i % 3 === 0 ? 2 : 1,
      });
    }
  }
  return { userId: targetId, interactions };
}

function makeRequest(items, limit, excludedRatio, preferences, collaborative) {
  const request = { items, limit };
  if (excludedRatio > 0) {
    const excluded = [];
    const step = Math.max(1, Math.round(1 / excludedRatio));
    for (let index = 0; index < items.length; index += step) {
      excluded.push(items[index].id);
    }
    request.excludeItemIds = excluded;
  }
  if (preferences !== undefined) {
    request.preferences = preferences;
  }
  if (collaborative !== undefined) {
    request.userId = collaborative.userId;
    request.interactions = collaborative.interactions;
  }
  return request;
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) {
    return 0;
  }
  const position = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[position];
}

function measure(recommender, request, targetMilliseconds) {
  for (let warmup = 0; warmup < 5; warmup += 1) {
    recommender.recommend(request);
  }

  const samples = [];
  const deadline = performance.now() + targetMilliseconds;
  while (performance.now() < deadline || samples.length < 20) {
    const started = process.hrtime.bigint();
    const result = recommender.recommend(request);
    const elapsed = Number(process.hrtime.bigint() - started) / 1_000_000;
    if (result.metadata.eligibleItems < 0) {
      throw new Error('Invalid benchmark result');
    }
    samples.push(elapsed);
    if (samples.length >= 2_000) {
      break;
    }
  }

  samples.sort((a, b) => a - b);
  const total = samples.reduce((sum, value) => sum + value, 0);
  return {
    iterations: samples.length,
    minMs: samples[0],
    meanMs: total / samples.length,
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    maxMs: samples[samples.length - 1],
    opsPerSecond: 1_000 / (total / samples.length),
  };
}

function collectEnvironment() {
  const cpuList = cpus();
  return {
    measuredAt: new Date().toISOString(),
    nodeVersion: process.version,
    v8Version: process.versions.v8,
    platform: platform(),
    platformRelease: release(),
    architecture: arch(),
    cpuModel: cpuList[0]?.model ?? 'unknown',
    logicalCpus: cpuList.length,
    totalMemoryBytes: totalmem(),
    gcExposed: typeof globalThis.gc === 'function',
  };
}

const scenarios = [
  {
    id: '1k-no-attrs-limit-10',
    items: 1_000,
    attributes: 0,
    limit: 10,
    excludedRatio: 0,
  },
  {
    id: '10k-no-attrs-limit-10',
    items: 10_000,
    attributes: 0,
    limit: 10,
    excludedRatio: 0,
  },
  {
    id: '10k-no-attrs-limit-100',
    items: 10_000,
    attributes: 0,
    limit: 100,
    excludedRatio: 0,
  },
  {
    id: '10k-20-attrs-limit-100',
    items: 10_000,
    attributes: 20,
    limit: 100,
    excludedRatio: 0,
    limits: {
      maxTotalAttributeNodes: 500_000,
      maxTotalAttributeCharacters: 5_000_000,
    },
  },
  {
    id: '10k-10pct-excluded-limit-10',
    items: 10_000,
    attributes: 0,
    limit: 10,
    excludedRatio: 0.1,
  },
  {
    id: '1k-content-5signals-baseline-limit-10',
    dataset: 'content',
    tagsPerItem: 4,
    items: 1_000,
    limit: 10,
    excludedRatio: 0,
    preferences: false,
  },
  {
    id: '1k-content-5signals-limit-10',
    dataset: 'content',
    tagsPerItem: 4,
    items: 1_000,
    limit: 10,
    excludedRatio: 0,
    preferences: true,
  },
  {
    id: '10k-content-5signals-baseline-limit-100',
    dataset: 'content',
    tagsPerItem: 4,
    items: 10_000,
    limit: 100,
    excludedRatio: 0,
    preferences: false,
    limits: {
      maxTotalAttributeNodes: 500_000,
      maxTotalAttributeCharacters: 5_000_000,
    },
  },
  {
    id: '10k-content-5signals-limit-100',
    dataset: 'content',
    tagsPerItem: 4,
    items: 10_000,
    limit: 100,
    excludedRatio: 0,
    preferences: true,
    limits: {
      maxTotalAttributeNodes: 500_000,
      maxTotalAttributeCharacters: 5_000_000,
    },
  },
  {
    id: '10k-content-heavy-tags-limit-100',
    dataset: 'content',
    tagsPerItem: 20,
    items: 10_000,
    limit: 100,
    excludedRatio: 0,
    preferences: true,
    limits: {
      maxTotalAttributeNodes: 500_000,
      maxTotalAttributeCharacters: 5_000_000,
    },
  },
  {
    id: '1k-collab-user-cosine-sparse',
    dataset: 'collaborative',
    items: 1_000,
    users: 200,
    interactionsPerUser: 8,
    limit: 10,
    excludedRatio: 0,
    strategy: 'collaborative',
    collaborative: { method: 'user', similarity: 'cosine', minOverlap: 1, maxNeighbors: 25 },
    limits: { maxInteractions: 10_000 },
  },
  {
    id: '1k-collab-item-cosine-sparse',
    dataset: 'collaborative',
    items: 1_000,
    users: 200,
    interactionsPerUser: 8,
    limit: 10,
    excludedRatio: 0,
    strategy: 'collaborative',
    collaborative: { method: 'item', similarity: 'cosine', minOverlap: 1, maxNeighbors: 25 },
    limits: { maxInteractions: 10_000 },
  },
  {
    id: '10k-collab-user-cosine-medium',
    dataset: 'collaborative',
    items: 10_000,
    users: 1_000,
    interactionsPerUser: 12,
    limit: 100,
    excludedRatio: 0,
    strategy: 'collaborative',
    collaborative: { method: 'user', similarity: 'cosine', minOverlap: 1, maxNeighbors: 50 },
    limits: { maxInteractions: 20_000, maxCollaborativeNeighbors: 50 },
  },
  {
    id: '10k-collab-item-jaccard-medium',
    dataset: 'collaborative',
    items: 10_000,
    users: 1_000,
    interactionsPerUser: 12,
    limit: 100,
    excludedRatio: 0,
    strategy: 'collaborative',
    collaborative: { method: 'item', similarity: 'jaccard', minOverlap: 1, maxNeighbors: 50 },
    limits: { maxInteractions: 20_000, maxCollaborativeNeighbors: 50 },
  },
  {
    id: 'cf-user-2k-users-total-eval-budget-500',
    dataset: 'collaborative',
    items: 2_000,
    users: 2_000,
    interactionsPerUser: 10,
    limit: 20,
    excludedRatio: 0,
    strategy: 'collaborative',
    collaborative: { method: 'user', similarity: 'cosine', minOverlap: 1, maxNeighbors: 50 },
    limits: {
      maxItems: 5_000,
      maxInteractions: 25_000,
      maxCollaborativeNeighbors: 50,
      maxCollaborativeSimilarityEvaluations: 500,
    },
  },
  {
    id: 'cf-user-2k-users-jaccard-total-eval-budget-500',
    dataset: 'collaborative',
    items: 2_000,
    users: 2_000,
    interactionsPerUser: 10,
    limit: 20,
    excludedRatio: 0,
    strategy: 'collaborative',
    collaborative: { method: 'user', similarity: 'jaccard', minOverlap: 1, maxNeighbors: 50 },
    limits: {
      maxItems: 5_000,
      maxInteractions: 25_000,
      maxCollaborativeNeighbors: 50,
      maxCollaborativeSimilarityEvaluations: 500,
    },
  },
  {
    id: 'cf-item-large-history-total-eval-budget-200',
    dataset: 'collaborative',
    items: 2_000,
    users: 300,
    interactionsPerUser: 8,
    targetInteractionsPerUser: 400,
    limit: 20,
    excludedRatio: 0,
    strategy: 'collaborative',
    collaborative: { method: 'item', similarity: 'cosine', minOverlap: 1, maxNeighbors: 50 },
    limits: {
      maxItems: 5_000,
      maxInteractions: 25_000,
      maxCollaborativeNeighbors: 50,
      maxCollaborativeSimilarityEvaluations: 200,
    },
  },
  {
    id: 'cf-item-large-history-jaccard-total-eval-budget-200',
    dataset: 'collaborative',
    items: 2_000,
    users: 300,
    interactionsPerUser: 8,
    targetInteractionsPerUser: 400,
    limit: 20,
    excludedRatio: 0,
    strategy: 'collaborative',
    collaborative: { method: 'item', similarity: 'jaccard', minOverlap: 1, maxNeighbors: 50 },
    limits: {
      maxItems: 5_000,
      maxInteractions: 25_000,
      maxCollaborativeNeighbors: 50,
      maxCollaborativeSimilarityEvaluations: 200,
    },
  },
];

const environment = collectEnvironment();
const results = [];

for (const scenario of scenarios) {
  const isContent = scenario.dataset === 'content';
  const isCollaborative = scenario.dataset === 'collaborative';
  const items = isContent
    ? makeContentDataset(scenario.items, scenario.tagsPerItem)
    : makeDataset(scenario.items, scenario.attributes ?? 0);
  const collaborative = isCollaborative
    ? makeCollaborativeData(
        scenario.items,
        scenario.users,
        scenario.interactionsPerUser,
        0,
        scenario.targetInteractionsPerUser ?? scenario.interactionsPerUser,
      )
    : undefined;
  const request = makeRequest(
    items,
    scenario.limit,
    scenario.excludedRatio,
    scenario.preferences === true ? makeContentPreferences() : undefined,
    collaborative,
  );
  const config = {};
  if (scenario.limits !== undefined) {
    config.limits = scenario.limits;
  }
  if (scenario.strategy !== undefined) {
    config.strategy = scenario.strategy;
  }
  if (scenario.collaborative !== undefined) {
    config.collaborative = scenario.collaborative;
  }
  const recommender =
    Object.keys(config).length === 0 ? createRecommender() : createRecommender(config);

  const result = recommender.recommend(request);
  if (result.recommendations.length > Math.min(scenario.limit, result.metadata.eligibleItems)) {
    throw new Error(`Unexpected result length for ${scenario.id}`);
  }
  if (isContent && scenario.preferences === true && result.strategy !== 'content') {
    throw new Error(`Expected the content strategy for ${scenario.id}`);
  }
  if (isCollaborative && result.strategy !== 'collaborative') {
    throw new Error(
      `Expected the collaborative strategy for ${scenario.id}, got ${result.strategy}`,
    );
  }
  if (!isContent && !isCollaborative && result.strategy !== 'baseline') {
    throw new Error(`Expected the baseline strategy for ${scenario.id}`);
  }

  if (typeof globalThis.gc === 'function') {
    globalThis.gc();
  }
  const heapBefore = process.memoryUsage().heapUsed;
  recommender.recommend(request);
  const heapAfterCall = process.memoryUsage().heapUsed;
  if (typeof globalThis.gc === 'function') {
    globalThis.gc();
  }
  const heapAfterGc = process.memoryUsage().heapUsed;

  const timing = measure(recommender, request, 1_000);
  results.push({
    ...scenario,
    datasetAttributeNodes: isContent
      ? scenario.items * (15 + scenario.tagsPerItem)
      : scenario.items * (1 + scenario.attributes * 2),
    returnedItems: result.metadata.returnedItems,
    eligibleItems: result.metadata.eligibleItems,
    strategy: result.strategy,
    heapUsedBeforeCallAfterGcBytes: heapBefore,
    heapUsedAfterCallBytes: heapAfterCall,
    heapUsedAfterCallAfterGcBytes: heapAfterGc,
    heapDeltaAfterGcBytes: heapAfterGc - heapBefore,
    ...timing,
  });
}

const report = {
  schemaVersion: 1,
  note: 'Synthetic local measurements. Results are machine-specific and not performance guarantees.',
  memoryNote:
    'Heap figures are sampled around one call. The "after call" value includes unreclaimed garbage; the final value is taken after an explicit GC when --expose-gc is available. They are not peak-memory measurements.',
  environment,
  scenarios: results,
};

writeFileSync(RESULTS_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

const header = [
  'scenario',
  'strategy',
  'n',
  'limit',
  'p50 ms',
  'p95 ms',
  'mean ms',
  'ops/s',
  'returned',
].join('\t');
console.log(header);
for (const entry of results) {
  console.log(
    [
      entry.id,
      entry.strategy,
      entry.items,
      entry.limit,
      entry.p50Ms.toFixed(3),
      entry.p95Ms.toFixed(3),
      entry.meanMs.toFixed(3),
      entry.opsPerSecond.toFixed(1),
      entry.returnedItems,
    ].join('\t'),
  );
}
console.log(`\nWrote ${RESULTS_PATH}`);
console.log(
  `Runtime: Node ${environment.nodeVersion}, V8 ${environment.v8Version}, ${environment.cpuModel}, ${environment.logicalCpus} logical CPUs, ${environment.platform} ${environment.platformRelease}.`,
);
