import test from 'node:test';
import assert from 'node:assert/strict';
import type { Edge } from 'reactflow';
import type { OsintNode, OsintProject } from '../types/osint';
import {
  buildSourceImageSignature,
  createDebouncedTask,
  isValidPersistedCanvasState,
  isValidPersistedProjectsState,
  serializeCanvasState,
  serializeProjectsState,
} from './canvasPersistence';

test('serializeCanvasState preserves core graph data and strips transient selection flags', () => {
  const nodes: OsintNode[] = [
    {
      id: 'img-1',
      type: 'imageNode',
      position: { x: 120, y: 240 },
      selected: true,
      dragging: true,
      width: 240,
      height: 260,
      data: {
        kind: 'image',
        title: 'Custom Aerial',
        imageUrl: 'data:image/png;base64,abc123',
        sourceLabel: 'Uploaded',
      },
    },
    {
      id: 'chat-2',
      type: 'chatNode',
      position: { x: 500, y: 200 },
      data: {
        kind: 'chat',
        title: 'Thread 2',
        draftPrompt: 'Inspect crane markings',
        messages: [],
      },
    },
  ];

  const edges: Edge[] = [
    {
      id: 'e-1',
      source: 'img-1',
      target: 'chat-2',
      sourceHandle: 'image-out',
      targetHandle: 'global-context',
      selected: true,
      type: 'redBezier',
    },
  ];

  const serialized = serializeCanvasState({
    nodes,
    edges,
    nodeCounter: 5,
    savedAt: '2026-11-15T22:00:00.000Z',
  });

  assert.equal(serialized.version, 1);
  assert.equal(serialized.nodeCounter, 5);
  assert.equal(serialized.nodes[0]?.position.x, 120);
  assert.equal('selected' in serialized.nodes[0]!, false);
  assert.equal('dragging' in serialized.nodes[0]!, false);
  assert.equal('selected' in serialized.edges[0]!, false);
  assert.equal(
    serialized.nodes[1]?.data.kind === 'chat' ? serialized.nodes[1].data.draftPrompt : '',
    'Inspect crane markings',
  );
  assert.equal(isValidPersistedCanvasState(serialized), true);
});

test('serializeProjectsState normalizes multiple projects and validates with isValidPersistedProjectsState', () => {
  const projects: OsintProject[] = [
    {
      id: 'proj-1',
      name: '  Maritime Vessel Tracking  ',
      createdAt: '2026-11-18T10:00:00.000Z',
      nodeCounter: 3,
      nodes: [
        {
          id: 'img-1',
          type: 'imageNode',
          position: { x: 40, y: 80 },
          selected: true,
          data: {
            kind: 'image',
            title: 'Satellite Pass',
            imageUrl: null,
          },
        },
      ],
      edges: [],
    },
    {
      id: 'proj-2',
      name: 'Urban Geolocation Case',
      createdAt: '2026-11-18T11:00:00.000Z',
      nodes: [],
      edges: [],
    },
  ];

  const serialized = serializeProjectsState({
    projects,
    currentProjectId: 'proj-1',
    savedAt: '2026-11-18T11:30:00.000Z',
  });

  assert.equal(serialized.version, 2);
  assert.equal(serialized.currentProjectId, 'proj-1');
  assert.equal(serialized.projects.length, 2);
  assert.equal(serialized.projects[0]?.name, 'Maritime Vessel Tracking');
  assert.equal('selected' in serialized.projects[0]!.nodes[0]!, false);
  assert.equal(isValidPersistedProjectsState(serialized), true);

  // Empty projects array is also valid (when user deletes all projects)
  const emptySerialized = serializeProjectsState({
    projects: [],
    currentProjectId: 'proj-1',
  });
  assert.equal(emptySerialized.currentProjectId, null);
  assert.equal(emptySerialized.projects.length, 0);
  assert.equal(isValidPersistedProjectsState(emptySerialized), true);
});

test('isValidPersistedCanvasState rejects malformed or outdated payloads', () => {
  assert.equal(isValidPersistedCanvasState(null), false);
  assert.equal(isValidPersistedCanvasState({ version: 2, nodes: [], edges: [], nodeCounter: 1 }), false);
  assert.equal(
    isValidPersistedCanvasState({
      version: 1,
      nodeCounter: 2,
      nodes: [{ id: 'bad-node', position: { x: 'nan', y: 0 }, data: {} }],
      edges: [],
    }),
    false,
  );
  assert.equal(
    isValidPersistedCanvasState({
      version: 1,
      nodeCounter: 1,
      nodes: [],
      edges: [{ id: 'e1', source: 'a' }],
    }),
    false,
  );
  assert.equal(
    isValidPersistedProjectsState({
      version: 2,
      currentProjectId: null,
      projects: [{ id: 'p1', name: 'Bad', createdAt: 'now', nodes: 'not-array', edges: [] }],
    }),
    false,
  );
});

test('buildSourceImageSignature distinguishes image sources and upscale factors', () => {
  const sig2x = buildSourceImageSignature('img-3', 'data:image/png;base64,xyz', 2);
  const sig4x = buildSourceImageSignature('img-3', 'data:image/png;base64,xyz', 4);
  const sigOther = buildSourceImageSignature('img-4', 'data:image/png;base64,xyz', 2);

  assert.ok(sig2x);
  assert.notEqual(sig2x, sig4x);
  assert.notEqual(sig2x, sigOther);
  assert.equal(buildSourceImageSignature(null, 'data:image/png;base64,xyz'), null);
});

test('createDebouncedTask coalesces rapid calls, flushes pending work, and respects cancel', async () => {
  const calls: string[] = [];
  const debounced = createDebouncedTask((val: string) => {
    calls.push(val);
  }, 40);

  debounced.schedule('a');
  debounced.schedule('b');
  debounced.schedule('c');
  assert.equal(debounced.hasPending(), true);
  assert.deepEqual(calls, []);

  await new Promise((resolve) => setTimeout(resolve, 65));
  assert.equal(debounced.hasPending(), false);
  assert.deepEqual(calls, ['c']);

  // Cancel discards pending execution
  debounced.schedule('d');
  assert.equal(debounced.hasPending(), true);
  debounced.cancel();
  assert.equal(debounced.hasPending(), false);
  await new Promise((resolve) => setTimeout(resolve, 65));
  assert.deepEqual(calls, ['c']);

  // Flush runs immediately
  debounced.schedule('e');
  debounced.flush();
  assert.equal(debounced.hasPending(), false);
  assert.deepEqual(calls, ['c', 'e']);
});
