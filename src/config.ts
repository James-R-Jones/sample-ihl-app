export const FHIR_API_BASE: string = (
  import.meta.env.VITE_FHIR_API_BASE ??
  'https://04sdlmjrsh.execute-api.us-east-1.amazonaws.com/test/fhir/sim-ibd-patients'
).replace(/\/+$/, '');
