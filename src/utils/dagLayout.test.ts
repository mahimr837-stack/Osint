import test from 'node:test';
import assert from 'node:assert/strict';
import type { Edge } from 'reactflow';
import type { OsintNode } from '../types/osint';
import { HANDLE_IDS } from './osintGraph';
import { computeDagLayout, getNodeLayoutDimensions } from './dagLayout';

function makeSampleNodes(): OsintNode[] {
  return [
    {
      id: 'img-1',
      type: 'imageNode',
      position: { x: 900, y: 700 },
      data: {
        kind: 'image',
        title: 'Frame A',
        imageUrl: null,
        sourceLabel: 'Source',
      },
    },
    {
      id: 'img-2',
      type: 'imageNode',
      position: { x: 850, y: 100 },
      data: {
        kind: 'image',
        title: 'Frame B',
        imageUrl: null,
        sourceLabel: 'Source',
      },
    },
    {
      id: 'chat-1',
      type: 'chatNode',
      position: { x: 120, y: 500 },
      data: {
        kind: 'chat',
        title: 'Inquiry',
        messages: [],
      },
    },
    {
      id: 'res-1',
      type: 'resultNode',
      position: { x: 40, y: 40 },
      data: {
        kind: 'result',
        title: 'Output',
        analysisText: 'Findings',
        enhancedImageUrl: null,
        enhancedCaption: '',
        sourceSummary: '1 source',
        updatedAt: '09:14',
      },
    },
  ];
}

test('computeDagLayout orders connected DAG hierarchy strictly left-to-right (Image -> Chat -> Result)', () => {
  const nodes = makeSampleNodes();
  const edges: Edge[] = [
    {
      id: 'e-group',
      source: 'img-1',
      target: 'img-2',
      sourceHandle: HANDLE_IDS.IMAGE_GROUP_OUT,
      targetHandle: HANDLE_IDS.IMAGE_GROUP_IN,
    },
    {
      id: 'e-img1-chat1',
      source: 'img-1',
      target: 'chat-1',
      sourceHandle: HANDLE_IDS.IMAGE_RIGHT_OUT,
      targetHandle: HANDLE_IDS.CHAT_GLOBAL_IN,
    },
    {
      id: 'e-chat1-res1',
      source: 'chat-1',
      target: 'res-1',
      sourceHandle: HANDLE_IDS.CHAT_RESULT_OUT,
      targetHandle: HANDLE_IDS.RESULT_IN,
    },
  ];

  const laidOut = computeDagLayout(nodes, edges);
  const byId = new Map(laidOut.map((n) => [n.id, n]));

  const img1 = byId.get('img-1')!;
  const img2 = byId.get('img-2')!;
  const chat1 = byId.get('chat-1')!;
  const res1 = byId.get('res-1')!;

  // Upstream images must be placed to the left of ChatNode, and ChatNode to the left of ResultNode
  assert.ok(
    img1.position.x < chat1.position.x,
    `Expected img-1.x (${img1.position.x}) < chat-1.x (${chat1.position.x})`,
  );
  assert.ok(
    img2.position.x < chat1.position.x,
    `Expected grouped img-2.x (${img2.position.x}) < chat-1.x (${chat1.position.x})`,
  );
  assert.ok(
    chat1.position.x < res1.position.x,
    `Expected chat-1.x (${chat1.position.x}) < res-1.x (${res1.position.x})`,
  );

  // Grouped images share the same rank column, place source above target, and do not overlap vertically
  assert.equal(img1.position.x, img2.position.x);
  assert.ok(
    img1.position.y < img2.position.y,
    `Expected img-1.y (${img1.position.y}) < img-2.y (${img2.position.y})`,
  );
  const img1Dims = getNodeLayoutDimensions(img1);
  assert.ok(
    img2.position.y - img1.position.y >= img1Dims.height,
    'Expected vertically grouped ImageNodes not to overlap',
  );
});

test('computeDagLayout produces non-overlapping bounding boxes across branching multi-node pipelines', () => {
  const nodes: OsintNode[] = [
    ...makeSampleNodes(),
    {
      id: 'ocr-1',
      type: 'ocrNode',
      position: { x: 0, y: 0 },
      data: {
        kind: 'ocr',
        title: 'OCR Scanner',
        extractedText: 'MSCU 123',
        confidence: 92,
        sourceTitle: 'Frame A',
        processedSignature: null,
      },
    },
    {
      id: 'pivot-1',
      type: 'pivotNode',
      position: { x: 0, y: 0 },
      data: {
        kind: 'pivot',
        title: 'Username Pivot',
        usernameInput: 'octocat',
        lastCheckedUsername: null,
        lastSourceSummary: null,
        results: [],
      },
    },
  ];

  const edges: Edge[] = [
    {
      id: 'e1',
      source: 'img-1',
      target: 'ocr-1',
      sourceHandle: HANDLE_IDS.IMAGE_RIGHT_OUT,
      targetHandle: HANDLE_IDS.OCR_IN,
    },
    {
      id: 'e2',
      source: 'ocr-1',
      target: 'chat-1',
      sourceHandle: HANDLE_IDS.OCR_OUT,
      targetHandle: HANDLE_IDS.CHAT_GLOBAL_IN,
    },
    {
      id: 'e3',
      source: 'ocr-1',
      target: 'pivot-1',
      sourceHandle: HANDLE_IDS.OCR_OUT,
      targetHandle: HANDLE_IDS.PIVOT_IN,
    },
    {
      id: 'e4',
      source: 'chat-1',
      target: 'res-1',
      sourceHandle: HANDLE_IDS.CHAT_RESULT_OUT,
      targetHandle: HANDLE_IDS.RESULT_IN,
    },
  ];

  const laidOut = computeDagLayout(nodes, edges);

  // Check pairwise bounding box non-overlap
  for (let i = 0; i < laidOut.length; i++) {
    for (let j = i + 1; j < laidOut.length; j++) {
      const a = laidOut[i];
      const b = laidOut[j];
      const dimA = getNodeLayoutDimensions(a);
      const dimB = getNodeLayoutDimensions(b);

      const overlapsX =
        a.position.x < b.position.x + dimB.width &&
        a.position.x + dimA.width > b.position.x;
      const overlapsY =
        a.position.y < b.position.y + dimB.height &&
        a.position.y + dimA.height > b.position.y;

      assert.equal(
        overlapsX && overlapsY,
        false,
        `Nodes ${a.id} and ${b.id} overlapped after computeDagLayout`,
      );
    }
  }
});

test('computeDagLayout handles empty node arrays safely', () => {
  assert.deepEqual(computeDagLayout([], []), []);
});
