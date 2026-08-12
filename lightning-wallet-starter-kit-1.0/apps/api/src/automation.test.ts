import { describe, expect, it, vi } from 'vitest';
import {
  createRuleSchema,
  dispatchNotification,
  maskDestination,
  retryAutomationJob,
  safeWebhook,
  validateChannel,
} from './automation.js';

const ruleId = '00000000-0000-4000-8000-000000000001';
const jobId = '00000000-0000-4000-8000-000000000002';
const channelId = '00000000-0000-4000-8000-000000000003';

describe('automation security', () => {
  it('accepts read-only alert rules and rejects unknown signing fields', () => {
    expect(createRuleSchema.parse({
      name: 'ETH price',
      kind: 'price',
      scheduleMinutes: 5,
      condition: { operator: 'above', threshold: 3000 },
      channels: ['email'],
    })).toMatchObject({ kind: 'price' });
    expect(() => createRuleSchema.parse({
      name: 'Bad rule',
      kind: 'price',
      scheduleMinutes: 5,
      condition: {},
      channels: [],
      privateKey: 'secret',
    })).toThrow();
  });

  it('blocks local and insecure webhooks', () => {
    expect(safeWebhook('https://alerts.example.com/hook')).toBe(true);
    expect(safeWebhook('http://localhost/hook')).toBe(false);
    expect(safeWebhook('https://127.0.0.1/hook')).toBe(false);
  });

  it('validates and masks channel destinations without exposing webhook secrets', () => {
    expect(validateChannel({ name: 'Ops', kind: 'email', destination: 'ops@example.com', enabled: false })).toBeTruthy();
    expect(maskDestination('ops@example.com', 'email')).toBe('op***@example.com');
    expect(maskDestination('https://alerts.example.com/hooks/super-secret-token', 'webhook')).toBe('https://alerts.example.com/***');
  });

  it('retries only queued or failed jobs and increments the attempt', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ rule_id: ruleId, attempt: 2 }] })
      .mockResolvedValueOnce({ rows: [{ id: ruleId, name: 'ETH price', kind: 'price', condition: {}, channels: [] }] })
      .mockResolvedValueOnce({ rows: [{ id: jobId, attempt: 3, status: 'completed' }] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await retryAutomationJob({ query }, jobId);
    expect(result).toMatchObject({ id: jobId, attempt: 3 });
    expect(query.mock.calls[0]?.[0]).toContain("status IN ('queued','failed')");
    expect(query.mock.calls[2]?.[1]?.[3]).toBe(3);
  });

  it('does not create a retry for a completed or missing job', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await expect(retryAutomationJob({ query }, jobId)).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('persists a redacted Dry Run notification audit job', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: channelId, kind: 'webhook', name: 'Ops', destination: 'https://alerts.example.com/hooks/super-secret-token', enabled: false }] })
      .mockResolvedValueOnce({ rows: [{ id: jobId, kind: 'notification', status: 'completed' }] });
    const result = await dispatchNotification({ query }, {
      channelId,
      subject: 'Sensitive subject',
      message: 'Sensitive notification body',
      dryRun: true,
    });
    expect(result).toMatchObject({ status: 'dry-run', delivered: false, destination: 'https://alerts.example.com/***', jobId });
    expect(query.mock.calls[1]?.[0]).toContain("'notification'");
    expect(JSON.stringify(query.mock.calls[1])).not.toMatch(/Sensitive subject|Sensitive notification body|super-secret-token/);
  });
});
