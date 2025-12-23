import { HttpClient } from './http-client.js';
import type {
  ConsentAcceptRequest,
  ConsentAcceptResponse,
  ConsentStatusResponse,
  ConsentTermsResponse,
} from './types.js';

export interface ConsentClientOptions {
  http: HttpClient;
  projectNameFallback?: string;
  projectDomainFallback?: string;
}

export interface BuildConsentMessageInput {
  projectName?: string | null;
  projectDomainOrSlug?: string | null;
  walletAddress: string;
  version: string;
  nonce?: string;
  issuedAt?: string;
  expiresAt?: string;
  ttlMinutes?: number; // default 10
}

export function buildConsentMessage(input: BuildConsentMessageInput): {
  message: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
} {
  const now = new Date();
  const issuedAt = input.issuedAt ?? now.toISOString();
  const ttlMinutes = input.ttlMinutes ?? 10;
  const expiresAt = input.expiresAt ?? new Date(now.getTime() + ttlMinutes * 60_000).toISOString();
  const nonce = input.nonce ?? (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

  const projectName = input.projectName ?? 'Project';
  const projectDomainOrSlug = input.projectDomainOrSlug ?? '';

  const message = `${projectName} consent\n` +
    `Project: ${projectDomainOrSlug}\n` +
    `Wallet: ${input.walletAddress}\n` +
    `Terms Version: ${input.version}\n` +
    `Nonce: ${nonce}\n` +
    `Issued At: ${issuedAt}\n` +
    `Expires At: ${expiresAt}`;

  return { message, nonce, issuedAt, expiresAt };
}

export class ConsentClient {
  private readonly http: HttpClient;
  private readonly projectNameFallback?: string;
  private readonly projectDomainFallback?: string;

  constructor(options: ConsentClientOptions) {
    this.http = options.http;
    this.projectNameFallback = options.projectNameFallback;
    this.projectDomainFallback = options.projectDomainFallback;
  }

  async getTerms(): Promise<ConsentTermsResponse> {
    return this.http.get<ConsentTermsResponse>('/v3/consent/terms');
  }

  async getStatus(walletAddress: string): Promise<ConsentStatusResponse> {
    return this.http.get<ConsentStatusResponse>(`/v3/consent/status/${encodeURIComponent(walletAddress)}`);
  }

  buildMessage(params: { walletAddress: string; version: string; terms?: ConsentTermsResponse }): ReturnType<typeof buildConsentMessage> {
    const project = params.terms?.project;
    return buildConsentMessage({
      walletAddress: params.walletAddress,
      version: params.version,
      projectName: project?.name ?? this.projectNameFallback,
      projectDomainOrSlug: project?.domain ?? project?.slug ?? this.projectDomainFallback,
    });
  }

  async accept(input: {
    walletAddress: string;
    signature: string;
    termsVersion?: string;
    terms?: ConsentTermsResponse;
    nonce?: string;
    issuedAt?: string;
    expiresAt?: string;
  }): Promise<ConsentAcceptResponse> {
    const terms = input.terms ?? (await this.getTerms());
    const version = input.termsVersion ?? terms.version;
    const messageMeta = this.buildMessage({ walletAddress: input.walletAddress, version, terms });

    const payload: ConsentAcceptRequest = {
      walletAddress: input.walletAddress,
      termsVersion: version,
      signature: input.signature,
      nonce: input.nonce ?? messageMeta.nonce,
      issuedAt: input.issuedAt ?? messageMeta.issuedAt,
      expiresAt: input.expiresAt ?? messageMeta.expiresAt,
    };

    return this.http.post<ConsentAcceptResponse>('/v3/consent/accept', payload);
  }
}
