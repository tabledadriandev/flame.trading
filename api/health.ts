import type { VercelRequest, VercelResponse } from './_lib/http.js';

// Proves the serverless side of the deployment is alive.
export default function handler(_req: VercelRequest, res: VercelResponse): void {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, service: 'flame', time: new Date().toISOString() });
}
