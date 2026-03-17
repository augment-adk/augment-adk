import { describe, it, expect, vi, afterEach } from 'vitest';
import { ApprovalStore, type PendingApproval } from '../../src/approval/ApprovalStore';

function makeApproval(overrides?: Partial<PendingApproval>): PendingApproval {
  return {
    responseId: 'resp-1',
    callId: 'call-1',
    functionName: 'tool_a',
    argumentsJson: '{}',
    serverId: 'srv',
    serverUrl: 'http://srv',
    originalToolName: 'tool_a',
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('ApprovalStore', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stores and retrieves approvals', () => {
    const store = new ApprovalStore();
    const approval = makeApproval();
    store.store(approval);
    expect(store.size).toBe(1);
    expect(store.get('resp-1', 'call-1')).toEqual(approval);
  });

  it('returns undefined for unknown approvals', () => {
    const store = new ApprovalStore();
    expect(store.get('x', 'y')).toBeUndefined();
  });

  it('removes approvals', () => {
    const store = new ApprovalStore();
    store.store(makeApproval());
    store.remove('resp-1', 'call-1');
    expect(store.size).toBe(0);
    expect(store.get('resp-1', 'call-1')).toBeUndefined();
  });

  it('expires entries after TTL', () => {
    const now = Date.now();
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(now) // store call
      .mockReturnValue(now + 31 * 60 * 1000); // 31 minutes later

    const store = new ApprovalStore();
    store.store(makeApproval({ createdAt: now }));
    expect(store.get('resp-1', 'call-1')).toBeUndefined();
  });

  it('evicts oldest when MAX_PENDING is reached', () => {
    const store = new ApprovalStore();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    for (let i = 0; i < 100; i++) {
      store.store(makeApproval({
        responseId: `r-${i}`,
        callId: `c-${i}`,
        createdAt: now + i,
      }));
    }
    expect(store.size).toBe(100);

    store.store(makeApproval({
      responseId: 'r-100',
      callId: 'c-100',
      createdAt: now + 100,
    }));
    expect(store.size).toBe(100);
    expect(store.get('r-0', 'c-0')).toBeUndefined();
    expect(store.get('r-100', 'c-100')).toBeDefined();
  });
});
