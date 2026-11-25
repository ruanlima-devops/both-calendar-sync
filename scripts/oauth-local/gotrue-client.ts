/**
 * Minimal local GoTrue client for overnight E2E.
 * Host must be loopback. Never points at STAGE/PROD.
 */

export type GoTrueSession = {
  accessToken: string;
  refreshToken: string;
  userId: string;
  email: string;
};

function assertLocalGoTrue(url: string): string {
  const u = new URL(url);
  if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') {
    throw new Error('GoTrue URL must be loopback');
  }
  return url.replace(/\/$/, '');
}

export function goTrueBaseUrl(): string {
  return assertLocalGoTrue(process.env.GOTRUE_URL ?? 'http://127.0.0.1:9999');
}

export async function goTrueHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${goTrueBaseUrl()}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function signup(email: string, password: string): Promise<GoTrueSession> {
  const res = await fetch(`${goTrueBaseUrl()}/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok || !body.access_token) {
    throw new Error(`signup_failed:${String(body.error_code ?? body.msg ?? res.status)}`);
  }
  const user = body.user as { id: string; email?: string };
  return {
    accessToken: String(body.access_token),
    refreshToken: String(body.refresh_token ?? ''),
    userId: user.id,
    email: user.email ?? email,
  };
}

export async function login(email: string, password: string): Promise<GoTrueSession> {
  const res = await fetch(`${goTrueBaseUrl()}/token?grant_type=password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok || !body.access_token) {
    throw new Error(`login_failed:${String(body.error_code ?? body.msg ?? res.status)}`);
  }
  const user = body.user as { id: string; email?: string };
  return {
    accessToken: String(body.access_token),
    refreshToken: String(body.refresh_token ?? ''),
    userId: user.id,
    email: user.email ?? email,
  };
}

export async function refresh(refreshToken: string): Promise<GoTrueSession> {
  const res = await fetch(`${goTrueBaseUrl()}/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok || !body.access_token) {
    throw new Error(`refresh_failed:${String(body.error_code ?? body.msg ?? res.status)}`);
  }
  const user = body.user as { id: string; email?: string };
  return {
    accessToken: String(body.access_token),
    refreshToken: String(body.refresh_token ?? refreshToken),
    userId: user.id,
    email: user.email ?? '',
  };
}

export async function logout(accessToken: string): Promise<void> {
  await fetch(`${goTrueBaseUrl()}/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/** Validates JWT with GoTrue /user — mirrors Edge userFromRequest → auth.getUser. */
export async function userFromAccessToken(accessToken: string): Promise<{ id: string; email?: string } | null> {
  const res = await fetch(`${goTrueBaseUrl()}/user`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { id?: string; email?: string; code?: number };
  if (!body.id) return null;
  return { id: body.id, email: body.email };
}
