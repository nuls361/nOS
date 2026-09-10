import type { Pool } from 'pg';
import type { MiningSource, PlaybookProposal, PlaybookWriter } from './types.js';

export class PlaybookRepository implements PlaybookWriter {
  constructor(private readonly pool: Pool) {}

  async nextSource(): Promise<MiningSource | null> {
    const result = await this.pool.query<{
      source_type: MiningSource['sourceType']; source_id: string; question: string;
      answer: string; subject: string | null;
    }>(
      `WITH candidates AS (
         SELECT 'approved_reply'::text AS source_type, action.id::text AS source_id,
                COALESCE(message.body_text, card.payload->>'sender', card.title) AS question,
                action.payload->>'body' AS answer,
                action.payload->>'subject' AS subject,
                action.approved_at AS happened_at
         FROM actions action
         JOIN cards card ON card.id = action.card_id
         LEFT JOIN messages message ON card.source_type = 'gmail_message'
           AND message.external_id = card.source_id
         WHERE action.type = 'gmail_send' AND action.status IN ('approved', 'executing', 'executed')
           AND action.approved_at IS NOT NULL
           AND NULLIF(action.payload->>'body', '') IS NOT NULL
         UNION ALL
         SELECT 'reply_pair', incoming_message_id::text || ':' || reply_message_id::text,
                incoming_body, reply_body, subject, replied_at
         FROM reply_pairs
       )
       SELECT source_type, source_id, question, answer, subject
       FROM candidates candidate
       WHERE NOT EXISTS (
         SELECT 1 FROM playbook_mining_sources mined
         WHERE mined.source_type = candidate.source_type AND mined.source_id = candidate.source_id
       )
         -- Kurze Wortwechsel ("Danke!" / "Gerne!") taugen nicht als Playbook-
         -- Eintrag, kosten aber je einen Modelllauf. Das Archiv enthaelt davon
         -- ein Vielfaches der brauchbaren Faelle, deshalb hier aussortieren
         -- statt spaeter dafuer zu bezahlen.
         AND length(btrim(candidate.answer)) >= 200
         AND length(btrim(candidate.question)) >= 80
       -- Frisch Freigegebenes zuerst, dann die juengste Historie: bei begrenztem
       -- Budget soll es ins relevanteste Material fliessen, nicht in das aelteste.
       ORDER BY candidate.source_type = 'reply_pair', happened_at DESC
       LIMIT 1`
    );
    const row = result.rows[0];
    if (!row) return null;
    const entries = await this.pool.query<{ slug: string; title: string; content: string }>(
      'SELECT slug, title, content FROM playbook_entries ORDER BY slug LIMIT 50'
    );
    return {
      sourceType: row.source_type, sourceId: row.source_id, question: row.question,
      answer: row.answer, subject: row.subject, existingEntries: entries.rows
    };
  }

  async saveOutcome(source: MiningSource, proposal: PlaybookProposal): Promise<'proposed' | 'skipped'> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      let cardId: string | null = null;
      if (proposal.shouldUpdate && proposal.slug && proposal.title && proposal.markdown) {
        const card = await client.query<{ id: string }>(
          `INSERT INTO cards (type, status, urgency, title, payload, sources, source_type, source_id)
           VALUES ('playbook_update', 'open', 35, $1, $2, $3, 'playbook_mining', $4)
           RETURNING id`,
          [`Playbook: ${proposal.title}`, JSON.stringify({ reason: proposal.reason }),
            JSON.stringify([{ sourceId: `${source.sourceType}:${source.sourceId}`, label: source.subject }]),
            `${source.sourceType}:${source.sourceId}`]
        );
        cardId = card.rows[0]?.id ?? null;
        await client.query(
          `INSERT INTO actions (card_id, type, status, payload)
           VALUES ($1, 'playbook_upsert', 'pending', $2)`,
          [cardId, JSON.stringify({ slug: proposal.slug, title: proposal.title, markdown: proposal.markdown })]
        );
      }
      const outcome = cardId ? 'proposed' : 'skipped';
      await client.query(
        `INSERT INTO playbook_mining_sources (source_type, source_id, outcome, card_id)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [source.sourceType, source.sourceId, outcome, cardId]
      );
      await client.query('COMMIT');
      return outcome;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async upsert(input: { slug: string; title: string; markdown: string }): Promise<{ slug: string }> {
    await this.pool.query(
      `INSERT INTO playbook_entries (slug, title, content) VALUES ($1, $2, $3)
       ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, content = EXCLUDED.content, updated_at = now()`,
      [input.slug, input.title, input.markdown]
    );
    return { slug: input.slug };
  }
}
