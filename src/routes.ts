import { useEffect, useState } from 'react';

/**
 * Hash routes:
 *   #/                                   patient list
 *   #/patient/<id>                       patient dashboard
 *   #/patient/<id>/encounter/<encId>     one visit and everything linked to it
 */
/** Search to run on arrival, and optionally one result to open ("Type/id"). */
export interface SearchIntent { q: string; open?: string }

export type Route =
  | { name: 'list' }
  | { name: 'patient'; patientId: string; search?: SearchIntent }
  | { name: 'encounter'; patientId: string; encounterId: string };

const enc = encodeURIComponent;

export const href = {
  list: () => '#/',
  patient: (patientId: string, search?: SearchIntent) => {
    const qs = search?.q ? `?${new URLSearchParams({ q: search.q, ...(search.open ? { open: search.open } : {}) })}` : '';
    return `#/patient/${enc(patientId)}${qs}`;
  },
  encounter: (patientId: string, encounterId: string) =>
    `#/patient/${enc(patientId)}/encounter/${enc(encounterId)}`,
};

export function parse(hash: string): Route {
  const m = hash.match(/^#\/patient\/([^/?#]+)(?:\/encounter\/([^/?#]+))?/);
  if (!m) return { name: 'list' };
  const patientId = decodeURIComponent(m[1]);
  if (m[2]) return { name: 'encounter', patientId, encounterId: decodeURIComponent(m[2]) };
  const params = new URLSearchParams(hash.split('?')[1] ?? '');
  const q = params.get('q');
  return q
    ? { name: 'patient', patientId, search: { q, open: params.get('open') ?? undefined } }
    : { name: 'patient', patientId };
}

export function navigate(to: string) {
  window.location.hash = to.replace(/^#/, '');
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));
  useEffect(() => {
    const on = () => {
      setRoute(parse(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

/** Update the hash without a navigation (no scroll, no history entry). */
export function replaceHash(to: string) {
  history.replaceState(null, '', to.startsWith('#') ? to : `#${to}`);
}
