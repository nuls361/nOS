import { tool } from 'ai';
import { z } from 'zod';
import type { ContextRepository } from './context-repository.js';

export const createContextTools = (repository: ContextRepository, observedSources: Set<string>) => {
  const observe = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(observe);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (typeof record.sourceId === 'string') observedSources.add(record.sourceId);
    Object.values(record).forEach(observe);
  };
  const tracked = async <T>(operation: Promise<T>): Promise<T> => {
    const result = await operation;
    observe(result);
    return result;
  };

  return {
    search_mail: tool({
      description: 'Search historical inbound and sent email using PostgreSQL full-text search.',
      inputSchema: z.object({
        query: z.string().min(1).describe('German or English search terms; try synonyms across calls.'),
        limit: z.number().int().min(1).max(25).default(10)
      }),
      execute: ({ query, limit }) => tracked(repository.searchMail(query, limit))
    }),
    read_thread: tool({
      description: 'Read a complete email thread after finding a relevant message.',
      inputSchema: z.object({ threadId: z.string().uuid() }),
      execute: ({ threadId }) => tracked(repository.readThread(threadId))
    }),
    search_calls: tool({
      description: 'Search Attio call transcripts for prior decisions, commitments, and context.',
      inputSchema: z.object({ query: z.string().min(1), limit: z.number().int().min(1).max(20).default(10) }),
      execute: ({ query, limit }) => tracked(repository.searchCalls(query, limit))
    }),
    read_attio: tool({
      description: 'Read a synchronized Attio company or deal record by exact record ID.',
      inputSchema: z.object({ objectSlug: z.enum(['companies', 'deals']), recordId: z.string().min(1) }),
      execute: ({ objectSlug, recordId }) => tracked(repository.readAttio(objectSlug, recordId))
    }),
    read_playbook: tool({
      description: 'Read approved response guidance. Omit query to load all currently approved entries.',
      inputSchema: z.object({ query: z.string().min(1).optional() }),
      execute: ({ query }) => tracked(repository.readPlaybook(query))
    })
  };
};
