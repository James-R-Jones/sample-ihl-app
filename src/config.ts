import { ACTIVE_ENDPOINT } from './endpoints';

/** The data source for this page load; see endpoints.ts. */
export const ENDPOINT = ACTIVE_ENDPOINT;
export const FHIR_API_BASE: string = ENDPOINT.url.replace(/\/+$/, '');
