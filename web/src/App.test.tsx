import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json' }
});

afterEach(() => vi.unstubAllGlobals());

describe('App', () => {
  it('shows the single-user login when no session exists', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'unauthorized' }, 401)));
    render(<App />);
    expect(await screen.findByRole('heading', { name: /Bereit, Entscheidungen/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Passwort')).toBeInTheDocument();
  });

  it('supports card edit and approval from the stream', async () => {
    let approved = false;
    const card = {
      id: 'card-1', type: 'email_reply', status: 'open', urgency: 70, title: 'Antwort: Kampagne',
      payload: {}, sources: [{ sourceId: 'mail:1', label: 'Kundenmail' }], createdAt: '2026-09-10T12:00:00Z',
      actions: [{
        id: 'action-1', type: 'gmail_send', status: 'pending',
        payload: { to: ['kunde@example.com'], subject: 'Re: Kampagne', body: 'Alter Entwurf' }
      }]
    };
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/auth/session')) return json({ authenticated: true, email: 'niels@songpush.com' });
      if (path.endsWith('/cards')) return json(approved ? [] : [card]);
      if (path.endsWith('/actions/action-1') && init?.method === 'PATCH') return json({ updated: true });
      if (path.endsWith('/actions/action-1/approve')) { approved = true; return json({ approved: true }); }
      return json({ error: 'not_found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Antwort: Kampagne' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Editieren' }));
    fireEvent.change(screen.getByLabelText('Entwurf'), { target: { value: 'Verbesserter Entwurf' } });
    fireEvent.click(screen.getByRole('button', { name: 'Änderung sichern' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/actions/action-1', expect.objectContaining({
      method: 'PATCH', body: expect.stringContaining('Verbesserter Entwurf')
    })));
    fireEvent.click(await screen.findByRole('button', { name: 'Freigeben' }));
    expect(await screen.findByRole('heading', { name: 'Der Tisch ist frei.' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/actions/action-1/approve', expect.objectContaining({ method: 'POST' }));
  });

  it('replaces the mapped colleague when the forward recipient is edited', async () => {
    const card = {
      id: 'card-1', type: 'email_reply', status: 'open', urgency: 60, title: 'Angebot',
      payload: {}, sources: [], createdAt: new Date().toISOString(),
      actions: [{
        id: 'action-1', type: 'gmail_forward', status: 'pending',
        payload: { colleague: 'Lina', subject: 'Fwd: Angebot', body: 'Bitte übernehmen.' }
      }]
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/auth/session') return json({ authenticated: true, email: 'niels@songpush.com' });
      if (url === '/api/cards') return json([card]);
      if (url === '/api/actions/action-1' && init?.method === 'PATCH') return json({ updated: true });
      return json({});
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Editieren' }));
    fireEvent.change(screen.getByLabelText(/Empfänger/), { target: { value: 'noah@songpush.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Änderung sichern' }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([url, init]) =>
        url === '/api/actions/action-1' && (init as RequestInit | undefined)?.method === 'PATCH');
      expect(patch).toBeDefined();
      const sent = JSON.parse((patch![1] as RequestInit).body as string);
      // Ohne das Entfernen von 'colleague' ginge die Mail weiter an Lina,
      // waehrend die Oberflaeche Noah anzeigt.
      expect(sent.payload.colleague).toBeUndefined();
      expect(sent.payload.to).toEqual(['noah@songpush.com']);
    });
  });
});
