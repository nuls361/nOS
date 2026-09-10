import { useCallback, useEffect, useState, type FormEvent } from 'react';

type Json = Record<string, unknown>;
type Action = { id: string; type: string; status: string; payload: Json; error?: string | null };
type Card = {
  id: string; type: string; status: string; urgency: number; title: string; payload: Json;
  sources: Array<{ sourceId?: string; label?: string | null }>; createdAt: string; actions: Action[];
};

const api = async (path: string, init?: RequestInit) => {
  const response = await fetch(`/api${path}`, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers }
  });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? `HTTP ${response.status}`);
  return response.json();
};

const typeLabel: Record<string, string> = {
  call_followup: 'Call-Nachbereitung', email_reply: 'Antwortentwurf', delegation: 'Delegation'
};
const actionLabel: Record<string, string> = {
  gmail_send: 'E-Mail', gmail_forward: 'Weiterleitung', attio_update: 'Attio-Änderung', attio_task: 'Attio-Aufgabe'
};
const urgencyLabel = (value: number) => value >= 70 ? 'Heute' : value >= 50 ? 'Demnächst' : 'Wenn Zeit ist';
const strings = (value: unknown): string => Array.isArray(value) ? value.join(', ') : String(value ?? '');
const findCitations = (value: unknown): Array<{ sourceId: string; label?: string }> => {
  if (Array.isArray(value)) return value.flatMap(findCitations);
  if (!value || typeof value !== 'object') return [];
  const record = value as Json;
  const own = typeof record.sourceId === 'string'
    ? [{ sourceId: record.sourceId, ...(typeof record.reason === 'string' ? { label: record.reason } : {}) }] : [];
  return [...own, ...Object.values(record).flatMap(findCitations)];
};

function Login({ onLogin }: { onLogin: (email: string) => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await api('/auth/login', { method: 'POST', body: JSON.stringify({ password }) });
      onLogin(result.email as string);
    } catch { setError('Das Passwort stimmt nicht.'); }
    finally { setBusy(false); }
  };
  return <main className="login-shell">
    <section className="login-card">
      <div className="brand-mark">n</div>
      <p className="kicker">nOS · persönlicher Arbeitsraum</p>
      <h1>Bereit, Entscheidungen abzunehmen.</h1>
      <p className="intro">Deine vorbereiteten Antworten, Nachfassaktionen und Delegationen — an einem ruhigen Ort.</p>
      <form onSubmit={submit}>
        <label htmlFor="password">Passwort</label>
        <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary wide" disabled={busy || !password}>{busy ? 'Öffne …' : 'Arbeitsraum öffnen'}</button>
      </form>
    </section>
  </main>;
}

function ActionEditor({ action, onDone }: { action: Action; onDone: () => Promise<void> }) {
  const [payload, setPayload] = useState(action.payload);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const set = (key: string, value: unknown) => setPayload((current) => ({ ...current, [key]: value }));
  const mutate = async (operation: 'save' | 'approve' | 'discard') => {
    setBusy(operation); setError('');
    try {
      if (operation === 'save') {
        await api(`/actions/${action.id}`, { method: 'PATCH', body: JSON.stringify({ payload }) });
        setEditing(false);
      } else {
        await api(`/actions/${action.id}/${operation}`, { method: 'POST' });
      }
      await onDone();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Aktion fehlgeschlagen'); }
    finally { setBusy(''); }
  };
  const isMail = action.type === 'gmail_send' || action.type === 'gmail_forward';
  const isUpdate = action.type === 'attio_update';
  const isTask = action.type === 'attio_task';
  return <article className="action-block">
    <header className="action-head">
      <span>{actionLabel[action.type] ?? action.type}</span>
      <span className={`status status-${action.status}`}>{action.status}</span>
    </header>
    {isMail && <div className="draft-paper">
      <label>Empfänger<input disabled={!editing} value={strings(payload.to ?? payload.colleague)} onChange={(e) => set('to', e.target.value)} /></label>
      <label>Betreff<input disabled={!editing} value={strings(payload.subject)} onChange={(e) => set('subject', e.target.value)} /></label>
      <label>Entwurf<textarea disabled={!editing} rows={8} value={strings(payload.body)} onChange={(e) => set('body', e.target.value)} /></label>
    </div>}
    {isUpdate && <div className="field-diff">
      <p className="field-name">{strings(payload.field)}</p>
      <div><span>Vorher</span><code>{strings(payload.currentValue)}</code></div>
      <div className="after"><span>Vorschlag</span>{editing
        ? <input value={strings(payload.proposedValue)} onChange={(e) => set('proposedValue', e.target.value)} />
        : <code>{strings(payload.proposedValue)}</code>}</div>
    </div>}
    {isTask && <div className="draft-paper">
      <label>Aufgabe<input disabled={!editing} value={strings(payload.title)} onChange={(e) => set('title', e.target.value)} /></label>
      <label>Beschreibung<textarea disabled={!editing} rows={4} value={strings(payload.description)} onChange={(e) => set('description', e.target.value)} /></label>
      <label>Zuständig<input disabled={!editing} value={strings(payload.assignee)} onChange={(e) => set('assignee', e.target.value || null)} /></label>
    </div>}
    {action.error && <p className="form-error">{action.error}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {action.status === 'pending' && <footer className="action-controls">
      {editing ? <>
        <button className="secondary" onClick={() => { setPayload(action.payload); setEditing(false); }}>Abbrechen</button>
        <button className="primary" disabled={Boolean(busy)} onClick={() => void mutate('save')}>Änderung sichern</button>
      </> : <>
        <button className="approve" disabled={Boolean(busy)} onClick={() => void mutate('approve')}>Freigeben</button>
        <button className="secondary" onClick={() => setEditing(true)}>Editieren</button>
        <button className="text-button danger" disabled={Boolean(busy)} onClick={() => void mutate('discard')}>Verwerfen</button>
      </>}
    </footer>}
  </article>;
}

function CardView({ card, refresh }: { card: Card; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const cardAction = async (operation: 'snooze' | 'discard') => {
    setBusy(true);
    const body = operation === 'snooze'
      ? JSON.stringify({ until: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString() }) : undefined;
    try {
      await api(`/cards/${card.id}/${operation}`, { method: 'POST', ...(body ? { body } : {}) });
      await refresh();
    }
    finally { setBusy(false); }
  };
  const citations = [...(card.sources ?? []), ...findCitations(card.payload),
    ...card.actions.flatMap((action) => findCitations(action.payload))]
    .filter((source, index, all) => all.findIndex((item) => item.sourceId === source.sourceId) === index);
  return <section className="work-card">
    <div className="urgency-rail" aria-hidden="true" />
    <header className="card-header">
      <div>
        <div className="meta-row"><span>{typeLabel[card.type] ?? card.type}</span><span>·</span><span>{urgencyLabel(card.urgency)}</span></div>
        <h2>{card.title}</h2>
      </div>
      <span className="urgency-score" title={`Dringlichkeit ${card.urgency}`}>{card.urgency}</span>
    </header>
    <div className="actions-list">
      {card.actions.map((action) => <ActionEditor key={action.id} action={action} onDone={refresh} />)}
    </div>
    {citations.length > 0 && <aside className="sources">
      <p>Quellen</p>
      <div>{citations.map((source, index) => <span key={source.sourceId ?? index}>{source.label || source.sourceId || 'Quelle'}</span>)}</div>
    </aside>}
    <footer className="card-footer">
      <time>{new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(card.createdAt))}</time>
      <div>
        <button className="text-button" disabled={busy} onClick={() => void cardAction('snooze')}>Bis morgen</button>
        <button className="text-button danger" disabled={busy} onClick={() => void cardAction('discard')}>Karte verwerfen</button>
      </div>
    </footer>
  </section>;
}

export const App = () => {
  const [email, setEmail] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const loadCards = useCallback(async () => {
    setLoading(true); setError('');
    try { setCards(await api('/cards') as Card[]); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Karten konnten nicht geladen werden'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    void api('/auth/session').then((result) => setEmail(result.email as string)).catch(() => setEmail(null)).finally(() => setChecking(false));
  }, []);
  useEffect(() => { if (email) void loadCards(); }, [email, loadCards]);
  if (checking) return <main className="loading-screen">nOS</main>;
  if (!email) return <Login onLogin={setEmail} />;
  return <main className="workspace">
    <header className="topbar">
      <div className="brand"><span className="brand-mark small">n</span><span>nOS</span></div>
      <div className="account"><span>{email}</span><button className="text-button" onClick={() => void api('/auth/logout', { method: 'POST' }).then(() => setEmail(null))}>Abmelden</button></div>
    </header>
    <section className="stream-header">
      <p className="kicker">Entscheidungsstrom</p>
      <h1>Was deine Aufmerksamkeit braucht.</h1>
      <p>{cards.length ? `${cards.length} vorbereitete ${cards.length === 1 ? 'Entscheidung' : 'Entscheidungen'}` : 'Alles erledigt'}</p>
    </section>
    {error && <p className="stream-error" role="alert">{error}</p>}
    <div className="stream" aria-busy={loading}>
      {!loading && cards.length === 0 && <section className="empty-state"><span>✓</span><h2>Der Tisch ist frei.</h2><p>Neue vorbereitete Arbeit erscheint automatisch hier.</p></section>}
      {cards.map((card) => <CardView key={card.id} card={card} refresh={loadCards} />)}
    </div>
  </main>;
};
