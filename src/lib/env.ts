// Flags read once from the URL.

const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);

/** `?sim=1` swaps every feed for a simulated one. Its numbers are labelled "Simulated" wherever they appear. */
export const SIM = params.get('sim') === '1';
