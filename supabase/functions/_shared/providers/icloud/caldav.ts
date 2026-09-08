/**
 * CalDAV client for Apple iCloud (RFC 4791 / WebDAV).
 * HTTPS-only, host allowlist, response size limits, no XXE (DOMParser).
 */

import { assertSafeIcloudUrl, ICLOUD_CALDAV } from './config.ts';
import { buildVEvent, parseVEvents, type IcsEvent } from './ics.ts';

export type CalDavAuth = { email: string; password: string };

export type DiscoveredCalendar = {
  href: string;
  displayName: string;
  color?: string;
  ctag?: string;
  syncToken?: string;
  /** owner | writer | reader */
  accessRole: string;
  isPrimary: boolean;
};

export type DiscoveryResult = {
  principalUrl: string;
  calendarHomeUrl: string;
  calendars: DiscoveredCalendar[];
};

function basicHeader(auth: CalDavAuth): string {
  const token = btoa(`${auth.email}:${auth.password}`);
  return `Basic ${token}`;
}

function textOf(el: Element | null): string {
  return (el?.textContent ?? '').trim();
}

function localName(node: Element): string {
  return (node.localName || node.tagName || '').toLowerCase();
}

function childrenByLocal(parent: Element, name: string): Element[] {
  return [...parent.getElementsByTagName('*')].filter((el) => localName(el) === name.toLowerCase()) as Element[];
}

function firstByLocal(parent: Element | Document, name: string): Element | null {
  const all = [...parent.getElementsByTagName('*')];
  return (all.find((el) => localName(el as Element) === name.toLowerCase()) as Element | undefined) ?? null;
}

async function caldavFetch(
  url: string,
  auth: CalDavAuth,
  init: RequestInit & { method: string },
): Promise<{ status: number; headers: Headers; text: string; finalUrl: string }> {
  const target = assertSafeIcloudUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ICLOUD_CALDAV.requestTimeoutMs);
  try {
    const res = await fetch(target.toString(), {
      ...init,
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        Authorization: basicHeader(auth),
        'User-Agent': 'Both/1.0 CalDAV',
        ...(init.headers ?? {}),
      },
    });

    // Follow a single HTTPS redirect to an allowed host.
    if ([301, 302, 307, 308].includes(res.status)) {
      const location = res.headers.get('location');
      if (!location) throw new Error('icloud_redirect_missing');
      const next = assertSafeIcloudUrl(new URL(location, target).toString());
      const res2 = await fetch(next.toString(), {
        ...init,
        redirect: 'error',
        signal: controller.signal,
        headers: {
          Authorization: basicHeader(auth),
          'User-Agent': 'Both/1.0 CalDAV',
          ...(init.headers ?? {}),
        },
      });
      const buf = new Uint8Array(await res2.arrayBuffer());
      if (buf.byteLength > ICLOUD_CALDAV.maxResponseBytes) throw new Error('icloud_response_too_large');
      return {
        status: res2.status,
        headers: res2.headers,
        text: new TextDecoder().decode(buf),
        finalUrl: next.toString(),
      };
    }

    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > ICLOUD_CALDAV.maxResponseBytes) throw new Error('icloud_response_too_large');
    return {
      status: res.status,
      headers: res.headers,
      text: new TextDecoder().decode(buf),
      finalUrl: target.toString(),
    };
  } catch (err) {
    if (String(err).includes('abort')) throw new Error('icloud_timeout');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function mapAuthError(status: number): never {
  if (status === 401 || status === 403) {
    const err = new Error('icloud_auth_failed');
    (err as { httpStatus?: number; status?: string }).httpStatus = status;
    (err as { status?: string }).status = 'AUTH_REQUIRED';
    throw err;
  }
  throw new Error(`icloud_http_${status}`);
}

function parseMultistatus(xml: string): Element[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (!doc) throw new Error('icloud_xml_parse_failed');
  // Reject if parsererror present
  if (firstByLocal(doc, 'parsererror')) throw new Error('icloud_xml_parse_failed');
  return childrenByLocal(doc.documentElement, 'response');
}

function hrefOfResponse(responseEl: Element): string {
  return textOf(firstByLocal(responseEl, 'href'));
}

function propstatOk(responseEl: Element): Element | null {
  for (const ps of childrenByLocal(responseEl, 'propstat')) {
    const status = textOf(firstByLocal(ps, 'status'));
    if (status.includes('200')) return firstByLocal(ps, 'prop');
  }
  return firstByLocal(responseEl, 'prop');
}

export async function discoverIcloud(auth: CalDavAuth): Promise<DiscoveryResult> {
  // 1) well-known
  let current = `${ICLOUD_CALDAV.discoveryOrigin}${ICLOUD_CALDAV.wellKnownPath}`;
  const wk = await caldavFetch(current, auth, {
    method: 'PROPFIND',
    headers: {
      Depth: '0',
      'Content-Type': 'application/xml; charset=utf-8',
    },
    body: `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:current-user-principal/></d:prop>
</d:propfind>`,
  });
  if (wk.status === 401 || wk.status === 403) mapAuthError(wk.status);
  if (wk.status >= 400 && wk.status !== 404) {
    // Some shards answer on root
    current = `${ICLOUD_CALDAV.discoveryOrigin}/`;
  } else {
    current = wk.finalUrl;
  }

  const principalProp = await caldavFetch(current, auth, {
    method: 'PROPFIND',
    headers: { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' },
    body: `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:current-user-principal/><d:displayname/></d:prop>
</d:propfind>`,
  });
  if (principalProp.status === 401 || principalProp.status === 403) mapAuthError(principalProp.status);
  if (principalProp.status >= 400) throw new Error('icloud_discovery_failed');

  const responses = parseMultistatus(principalProp.text);
  let principalPath = '';
  for (const r of responses) {
    const prop = propstatOk(r);
    const cup = prop ? firstByLocal(prop, 'current-user-principal') : null;
    const href = cup ? textOf(firstByLocal(cup, 'href')) : '';
    if (href) {
      principalPath = href;
      break;
    }
  }
  if (!principalPath) throw new Error('icloud_principal_not_found');

  const principalUrl = new URL(principalPath, principalProp.finalUrl).toString();
  assertSafeIcloudUrl(principalUrl);

  // 2) calendar-home-set
  const homeProp = await caldavFetch(principalUrl, auth, {
    method: 'PROPFIND',
    headers: { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' },
    body: `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><c:calendar-home-set/></d:prop>
</d:propfind>`,
  });
  if (homeProp.status === 401 || homeProp.status === 403) mapAuthError(homeProp.status);
  if (homeProp.status >= 400) throw new Error('icloud_calendar_home_failed');

  let homePath = '';
  for (const r of parseMultistatus(homeProp.text)) {
    const prop = propstatOk(r);
    const set = prop ? firstByLocal(prop, 'calendar-home-set') : null;
    const href = set ? textOf(firstByLocal(set, 'href')) : '';
    if (href) {
      homePath = href;
      break;
    }
  }
  if (!homePath) throw new Error('icloud_calendar_home_not_found');
  const calendarHomeUrl = new URL(homePath, homeProp.finalUrl).toString();
  assertSafeIcloudUrl(calendarHomeUrl);

  // 3) list calendars
  const list = await caldavFetch(calendarHomeUrl, auth, {
    method: 'PROPFIND',
    headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
    body: `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:ic="http://apple.com/ns/ical/">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <d:current-user-privilege-set/>
    <cs:getctag/>
    <d:sync-token/>
    <ic:calendar-color/>
    <c:supported-calendar-component-set/>
  </d:prop>
</d:propfind>`,
  });
  if (list.status === 401 || list.status === 403) mapAuthError(list.status);
  if (list.status >= 400) throw new Error('icloud_list_calendars_failed');

  const calendars: DiscoveredCalendar[] = [];
  for (const r of parseMultistatus(list.text)) {
    const href = hrefOfResponse(r);
    const prop = propstatOk(r);
    if (!prop || !href) continue;
    const rt = firstByLocal(prop, 'resourcetype');
    const isCalendar = rt ? Boolean(firstByLocal(rt, 'calendar')) : false;
    if (!isCalendar) continue;

    // Prefer VEVENT collections
    const comps = firstByLocal(prop, 'supported-calendar-component-set');
    if (comps) {
      const names = childrenByLocal(comps, 'comp').map((c) => c.getAttribute('name')?.toUpperCase());
      if (names.length && !names.includes('VEVENT')) continue;
    }

    const privileges = firstByLocal(prop, 'current-user-privilege-set');
    const privText = privileges?.textContent?.toLowerCase() ?? '';
    const canWrite =
      privText.includes('write') ||
      privText.includes('bind') ||
      privText.includes('unbind') ||
      privText.includes('write-content');
    const absolute = new URL(href, list.finalUrl).toString();
    assertSafeIcloudUrl(absolute);

    calendars.push({
      href: absolute,
      displayName: textOf(firstByLocal(prop, 'displayname')) || 'Calendar',
      color: textOf(firstByLocal(prop, 'calendar-color')) || undefined,
      ctag: textOf(firstByLocal(prop, 'getctag')) || undefined,
      syncToken: textOf(firstByLocal(prop, 'sync-token')) || undefined,
      accessRole: canWrite ? 'owner' : 'reader',
      isPrimary: false,
    });
  }

  if (calendars.length === 0) throw new Error('icloud_no_calendars');
  // Mark first writable as primary when possible
  const primary = calendars.find((c) => c.accessRole !== 'reader') ?? calendars[0]!;
  primary.isPrimary = true;

  return { principalUrl, calendarHomeUrl, calendars };
}

function timeRangeXml(timeMin: string, timeMax: string): string {
  const start = timeMin.replace(/\.\d{3}Z$/, 'Z');
  const end = timeMax.replace(/\.\d{3}Z$/, 'Z');
  return `<c:time-range start="${start.replace(/[-:]/g, '').replace('.000', '')}" end="${end.replace(/[-:]/g, '').replace('.000', '')}"/>`;
}

export async function queryEvents(
  auth: CalDavAuth,
  calendarHref: string,
  range: { timeMin: string; timeMax: string },
): Promise<Array<{ href: string; etag?: string; ics: string; events: IcsEvent[] }>> {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        ${timeRangeXml(range.timeMin, range.timeMax)}
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;

  const res = await caldavFetch(calendarHref, auth, {
    method: 'REPORT',
    headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
    body,
  });
  if (res.status === 401 || res.status === 403) mapAuthError(res.status);
  if (res.status >= 400) throw new Error('icloud_query_failed');

  const out: Array<{ href: string; etag?: string; ics: string; events: IcsEvent[] }> = [];
  for (const r of parseMultistatus(res.text)) {
    const href = hrefOfResponse(r);
    const prop = propstatOk(r);
    if (!href || !prop) continue;
    const ics = textOf(firstByLocal(prop, 'calendar-data'));
    if (!ics) continue;
    const etag = textOf(firstByLocal(prop, 'getetag')) || undefined;
    const absolute = new URL(href, res.finalUrl).toString();
    out.push({ href: absolute, etag, ics, events: parseVEvents(ics) });
  }
  return out;
}

/** RFC 6578 sync-collection. Returns changed hrefs; deleted marked missing. */
export async function syncCollection(
  auth: CalDavAuth,
  calendarHref: string,
  syncToken: string,
): Promise<{
  changes: Array<{ href: string; etag?: string; deleted?: boolean }>;
  nextSyncToken?: string;
  needsFullResync?: boolean;
}> {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<d:sync-collection xmlns:d="DAV:">
  <d:sync-token>${escapeXml(syncToken)}</d:sync-token>
  <d:sync-level>1</d:sync-level>
  <d:prop><d:getetag/></d:prop>
</d:sync-collection>`;

  const res = await caldavFetch(calendarHref, auth, {
    method: 'REPORT',
    headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
    body,
  });
  if (res.status === 401 || res.status === 403) mapAuthError(res.status);
  if (res.status === 403 || res.status === 409 || res.text.toLowerCase().includes('valid-sync-token')) {
    return { changes: [], needsFullResync: true };
  }
  if (res.status >= 400) throw new Error('icloud_sync_collection_failed');

  const changes: Array<{ href: string; etag?: string; deleted?: boolean }> = [];
  let nextSyncToken: string | undefined;
  for (const r of parseMultistatus(res.text)) {
    const href = hrefOfResponse(r);
    const status = textOf(firstByLocal(r, 'status'));
    if (status.includes('404')) {
      if (href) changes.push({ href: new URL(href, res.finalUrl).toString(), deleted: true });
      continue;
    }
    const prop = propstatOk(r);
    if (href && prop) {
      changes.push({
        href: new URL(href, res.finalUrl).toString(),
        etag: textOf(firstByLocal(prop, 'getetag')) || undefined,
      });
    }
  }
  const doc = new DOMParser().parseFromString(res.text, 'text/xml');
  nextSyncToken = textOf(firstByLocal(doc!, 'sync-token')) || undefined;
  return { changes, nextSyncToken };
}

export async function getResource(
  auth: CalDavAuth,
  href: string,
): Promise<{ ics: string; etag?: string }> {
  const res = await caldavFetch(href, auth, { method: 'GET', headers: { Accept: 'text/calendar' } });
  if (res.status === 401 || res.status === 403) mapAuthError(res.status);
  if (res.status === 404) throw Object.assign(new Error('icloud_not_found'), { httpStatus: 404 });
  if (res.status >= 400) throw new Error('icloud_get_failed');
  return { ics: res.text, etag: res.headers.get('etag') ?? undefined };
}

export async function putEvent(
  auth: CalDavAuth,
  href: string,
  ics: string,
  ifMatch?: string,
): Promise<{ etag?: string }> {
  const headers: Record<string, string> = {
    'Content-Type': 'text/calendar; charset=utf-8',
  };
  if (ifMatch) headers['If-Match'] = ifMatch;
  else headers['If-None-Match'] = '*';

  const res = await caldavFetch(href, auth, { method: 'PUT', headers, body: ics });
  if (res.status === 401 || res.status === 403) mapAuthError(res.status);
  if (res.status === 412) {
    throw Object.assign(new Error('icloud_etag_conflict'), { httpStatus: 412 });
  }
  if (res.status >= 400) throw new Error('icloud_put_failed');
  return { etag: res.headers.get('etag') ?? undefined };
}

export async function deleteResource(
  auth: CalDavAuth,
  href: string,
  ifMatch?: string,
): Promise<void> {
  const headers: Record<string, string> = {};
  if (ifMatch) headers['If-Match'] = ifMatch;
  const res = await caldavFetch(href, auth, { method: 'DELETE', headers });
  if (res.status === 401 || res.status === 403) mapAuthError(res.status);
  if (res.status === 404 || res.status === 410) return;
  if (res.status >= 400) throw new Error('icloud_delete_failed');
}

export async function readCalendarProps(
  auth: CalDavAuth,
  calendarHref: string,
): Promise<{ ctag?: string; syncToken?: string }> {
  const res = await caldavFetch(calendarHref, auth, {
    method: 'PROPFIND',
    headers: { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' },
    body: `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/">
  <d:prop><cs:getctag/><d:sync-token/></d:prop>
</d:propfind>`,
  });
  if (res.status === 401 || res.status === 403) mapAuthError(res.status);
  if (res.status >= 400) return {};
  const prop = propstatOk(parseMultistatus(res.text)[0]!);
  if (!prop) return {};
  return {
    ctag: textOf(firstByLocal(prop, 'getctag')) || undefined,
    syncToken: textOf(firstByLocal(prop, 'sync-token')) || undefined,
  };
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function buildEventIcs(input: Parameters<typeof buildVEvent>[0]): string {
  return buildVEvent(input);
}

export function authFromBasicToken(accessToken: string): CalDavAuth {
  // accessToken format: "email\\npassword" encrypted path produces plain via runtime
  // Prefer explicit pack: base64url JSON — but runtime passes "email:password" after decrypt assemble.
  const idx = accessToken.indexOf('\n');
  if (idx > 0) {
    return { email: accessToken.slice(0, idx), password: accessToken.slice(idx + 1) };
  }
  // Fallback Basic decode
  if (accessToken.startsWith('Basic ')) {
    const decoded = atob(accessToken.slice(6));
    const colon = decoded.indexOf(':');
    return { email: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
  }
  throw new Error('icloud_bad_credentials_pack');
}
