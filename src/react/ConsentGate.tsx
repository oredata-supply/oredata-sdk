'use client';

import { useEffect, useMemo, useState } from 'react';
import { ConsentClient, buildConsentMessage } from '../consent-client.js';
import type { ConsentStatusResponse, ConsentTermsResponse } from '../types.js';

export interface ConsentGateProps {
  client: ConsentClient;
  walletAddress?: string | null;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
  onAccepted?: (info: { acceptedAt: string; version: string; created: boolean }) => void;
  onDeclined?: () => void;
  pollingMs?: number;
  children: React.ReactNode;
}

export function ConsentGate({
  client,
  walletAddress,
  signMessage,
  onAccepted,
  onDeclined,
  pollingMs = 30_000,
  children,
}: ConsentGateProps) {
  const [status, setStatus] = useState<ConsentStatusResponse | null>(null);
  const [terms, setTerms] = useState<ConsentTermsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const needsConsent = status?.status === 'missing' || status?.status === 'outdated';

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    async function fetchAll() {
      if (!walletAddress) return;
      try {
        setLoading(true);
        const [t, s] = await Promise.all([client.getTerms(), client.getStatus(walletAddress)]);
        setTerms(t);
        setStatus(s);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load consent');
      } finally {
        setLoading(false);
      }
    }
    void fetchAll();
    if (pollingMs > 0) {
      timer = setInterval(fetchAll, pollingMs);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [client, walletAddress, pollingMs]);

  const onAcceptClick = useMemo(() => {
    return async () => {
      if (!walletAddress || !terms) return;
      setSubmitting(true);
      setError(null);
      try {
        const msgMeta = buildConsentMessage({
          projectName: terms.project?.name ?? 'Project',
          projectDomainOrSlug: terms.project?.domain ?? terms.project?.slug ?? '',
          walletAddress,
          version: terms.version,
        });
        const signatureBytes = await signMessage(new TextEncoder().encode(msgMeta.message));
        const signature = (await import('bs58')).default.encode(signatureBytes);
        const resp = await client.accept({
          walletAddress,
          signature,
          termsVersion: terms.version,
          nonce: msgMeta.nonce,
          issuedAt: msgMeta.issuedAt,
          expiresAt: msgMeta.expiresAt,
          terms,
        });
        setStatus({ status: 'accepted', currentVersion: terms.version, acceptedVersion: terms.version, acceptedAt: resp.acceptedAt });
        onAccepted?.({ acceptedAt: resp.acceptedAt, version: resp.version, created: resp.created });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to accept');
      } finally {
        setSubmitting(false);
      }
    };
  }, [walletAddress, terms, client, signMessage, onAccepted]);

  if (!walletAddress) {
    return <>{children}</>;
  }

  if (loading || !status || !terms) {
    return <p className="text-sm text-muted-foreground">Checking consent…</p>;
  }

  if (!needsConsent) {
    return <>{children}</>;
  }

  return (
    <div className="border rounded-md p-4 space-y-3">
      <div>
        <p className="text-sm font-medium">Please accept the latest terms ({terms.version})</p>
        {terms.changelog && <p className="text-xs text-muted-foreground">Changes: {terms.changelog}</p>}
      </div>
      <div className="max-h-48 overflow-y-auto bg-muted/50 rounded p-2 text-sm whitespace-pre-wrap">
        {terms.bodyMd}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          className="px-3 py-2 rounded bg-foreground text-background text-sm"
          onClick={onAcceptClick}
          disabled={submitting}
        >
          {submitting ? 'Signing…' : 'Accept & Continue'}
        </button>
        <button
          type="button"
          className="px-3 py-2 rounded border text-sm"
          onClick={() => onDeclined?.()}
        >
          Decline
        </button>
      </div>
    </div>
  );
}

