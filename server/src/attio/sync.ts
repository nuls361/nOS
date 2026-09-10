import { AttioApiError } from './client.js';
import type { AttioRepository } from './repository.js';
import type { AttioClient } from './types.js';

type AttioStore = Pick<AttioRepository,
  'saveRecord' | 'saveMeeting' | 'saveRecording' | 'needsTranscript' | 'saveTranscript'
  | 'savePollTime' | 'getPollTime'>;

export interface AttioRecordSyncResult {
  companies: number;
  deals: number;
}

export interface AttioSyncResult {
  meetings: number;
  recordings: number;
  transcripts: number;
}

export class AttioSync {
  constructor(private readonly client: AttioClient, private readonly repository: AttioStore) {}

  private async syncObject(objectSlug: 'companies' | 'deals'): Promise<number> {
    let offset = 0;
    let total = 0;
    while (true) {
      const records = await this.client.listRecords(objectSlug, offset);
      for (const record of records) await this.repository.saveRecord(objectSlug, record);
      total += records.length;
      if (records.length < 500) return total;
      offset += 500;
    }
  }

  /**
   * Vollabzug der CRM-Records. Teuer: der Workspace hat >40k Companies, ein
   * Durchlauf dauert Minuten. Gehört in einen eigenen, seltenen Cron-Lauf und
   * darf den 15-Minuten-Poll der Aufnahmen nicht blockieren. Attio erlaubt
   * weder Filter noch Sortierung auf updated_at, ein Delta ist also nicht möglich.
   */
  async syncRecords(): Promise<AttioRecordSyncResult> {
    return { companies: await this.syncObject('companies'), deals: await this.syncObject('deals') };
  }

  /**
   * Der 15-Minuten-Lauf: nur Meetings, Aufnahmen und Transkripte. Das Fenster
   * beginnt beim letzten erfolgreichen Poll (mit Sicherheitsabstand), fällt auf
   * lookbackHours zurück, solange es keinen Zustand gibt.
   */
  async run(now = new Date(), lookbackHours = 24): Promise<AttioSyncResult> {
    const result: AttioSyncResult = { meetings: 0, recordings: 0, transcripts: 0 };
    const fallbackFrom = now.getTime() - lookbackHours * 60 * 60 * 1_000;
    const lastPoll = await this.repository.getPollTime();
    // Eine Stunde Überlappung: Transkripte erscheinen verzögert, und ein
    // erneut gesehenes Meeting kostet nur einen Upsert.
    const windowStart = lastPoll ? Math.min(lastPoll.getTime() - 3_600_000, now.getTime()) : fallbackFrom;
    const filters = {
      endsFrom: new Date(windowStart).toISOString(),
      startsBefore: now.toISOString()
    };
    let meetingCursor: string | undefined;
    do {
      const meetingPage = await this.client.listMeetings(filters, meetingCursor);
      for (const meeting of meetingPage.items) {
        const meetingDatabaseId = await this.repository.saveMeeting(meeting);
        result.meetings += 1;
        let recordingCursor: string | undefined;
        do {
          const recordingPage = await this.client.listCallRecordings(meeting.id.meeting_id, recordingCursor);
          for (const recording of recordingPage.items) {
            await this.repository.saveRecording(meetingDatabaseId, recording);
            result.recordings += 1;
            if (recording.status !== 'completed' ||
                !await this.repository.needsTranscript(recording.id.call_recording_id)) continue;
            try {
              const transcript = await this.client.getTranscript(
                meeting.id.meeting_id, recording.id.call_recording_id
              );
              await this.repository.saveTranscript(recording.id.call_recording_id, transcript);
              result.transcripts += 1;
            } catch (error) {
              if (error instanceof AttioApiError && (error.status === 404 || error.status === 409)) continue;
              throw error;
            }
          }
          recordingCursor = recordingPage.nextCursor;
        } while (recordingCursor);
      }
      meetingCursor = meetingPage.nextCursor;
    } while (meetingCursor);
    await this.repository.savePollTime(now);
    return result;
  }
}
