import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErpAccessGate } from './ErpAccessGate';

const fixture = vi.hoisted(() => ({
  webAdmitted: true,
  globalAdmitted: true,
  failed: false,
  signedIn: true,
  callback: undefined as (() => void) | undefined,
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: {
    getSession: async () => ({ data: { session: fixture.signedIn ? { user: { id: 'synthetic-user' } } : null }, error: null }),
    onAuthStateChange: (callback: () => void) => {
      fixture.callback = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    },
    signOut: vi.fn(),
  },
  rpc: async (name: string) => ({
    data: { enabled: true, admitted: name === 'erp_access_status' ? fixture.globalAdmitted : fixture.webAdmitted, manager: false, version: 1, ready: false },
    error: fixture.failed ? new Error('Unavailable') : null,
  }),
} }));

const open = (path = '/compras') => render(<MemoryRouter initialEntries={[path]}><ErpAccessGate><div data-testid="internal-workspace" /></ErpAccessGate></MemoryRouter>);
describe('independent web admission', () => {
  beforeEach(() => { fixture.webAdmitted = true; fixture.globalAdmitted = true; fixture.failed = false; fixture.signedIn = true; });
  it('denies an authenticated Google callback on /login before mounting the login redirect', async () => {
    fixture.webAdmitted = false;
    open('/login');
    await screen.findByRole('heading');
    expect(screen.queryByTestId('internal-workspace')).not.toBeInTheDocument();
  });
  it('allows an admitted account to continue from /login', async () => {
    open('/login');
    expect(await screen.findByTestId('internal-workspace')).toBeInTheDocument();
  });
  it('keeps Google login available before authentication then denies the blocked session', async () => {
    fixture.signedIn = false;
    fixture.webAdmitted = false;
    open('/login');
    await screen.findByTestId('internal-workspace');
    fixture.signedIn = true;
    act(() => { fixture.callback?.(); });
    await waitFor(() => expect(screen.queryByTestId('internal-workspace')).not.toBeInTheDocument());
    await screen.findByRole('heading');
  });
  it('retains the workspace for a server-admitted user', async () => {
    open();
    expect(await screen.findByTestId('internal-workspace')).toBeInTheDocument();
  });
  it('does not mount the workspace for a web-denied user while global access remains allowed', async () => {
    fixture.webAdmitted = false;
    open();
    await screen.findByRole('heading');
    expect(screen.queryByTestId('internal-workspace')).not.toBeInTheDocument();
  });
  it('does not override existing global denial', async () => {
    fixture.globalAdmitted = false;
    open();
    await screen.findByRole('heading');
    expect(screen.queryByTestId('internal-workspace')).not.toBeInTheDocument();
  });
  it('removes an already mounted workspace after an auth change returns web denial', async () => {
    open();
    await screen.findByTestId('internal-workspace');
    fixture.webAdmitted = false;
    act(() => { fixture.callback?.(); });
    await waitFor(() => expect(screen.queryByTestId('internal-workspace')).not.toBeInTheDocument());
    await screen.findByRole('heading');
  });
  it('does not mount protected screens when verification fails', async () => {
    fixture.failed = true;
    open();
    await screen.findByRole('heading');
    expect(screen.queryByTestId('internal-workspace')).not.toBeInTheDocument();
  });
});