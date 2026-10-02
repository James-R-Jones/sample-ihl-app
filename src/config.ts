export const FHIR_API_BASE: string = (
  import.meta.env.VITE_FHIR_API_BASE ??
  'https://www.smartcumulus.org/synthetic/fhir/sim-ibd-patients'
).replace(/\/+$/, '');
