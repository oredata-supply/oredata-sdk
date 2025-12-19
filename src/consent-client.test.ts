import { describe, it, expect, vi } from 'vitest';
import { ConsentClient, buildConsentMessage } from './consent-client.js';

describe('buildConsentMessage', () => {
  it('builds canonical message with defaults', () => {
    const { message, nonce, issuedAt, expiresAt } = buildConsentMessage({
      projectName: 'orepump.fun',
      projectDomainOrSlug: 'orepump.fun',
      walletAddress: 'wallet123',
      version: '1.0',
      ttlMinutes: 5,
    });
    expect(message).toContain('orepump.fun consent');
    expect(message).toContain('Project: orepump.fun');
    expect(message).toContain('Wallet: wallet123');
    expect(message).toContain('Terms Version: 1.0');
    expect(message).toContain('Nonce:');
    expect(nonce).toBeTruthy();
    expect(new Date(issuedAt).getTime()).toBeLessThanOrEqual(Date.now());
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(new Date(issuedAt).getTime());
  });
});

describe('ConsentClient.accept', () => {
  it('posts accept payload with resolved terms', async () => {
    const mockGet = vi.fn().mockResolvedValue({ version: '1.2', project: { name: 'Proj', domain: 'proj.fun' } });
    const mockPost = vi.fn().mockResolvedValue({ success: true, acceptedAt: '2025-12-11T00:00:00Z', version: '1.2', created: true });
    const http = { get: mockGet, post: mockPost } as any;
    const client = new ConsentClient({ http });
    await client.accept({ walletAddress: 'wallet123', signature: 'sig123' });
    expect(mockGet).toHaveBeenCalledWith('/v3/consent/terms');
    expect(mockPost).toHaveBeenCalledWith('/v3/consent/accept', expect.objectContaining({
      walletAddress: 'wallet123',
      termsVersion: '1.2',
      signature: 'sig123',
    }));
  });
});

