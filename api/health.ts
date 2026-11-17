import type { VercelRequest, VercelResponse } from '@vercel/node';

// Proves the serverless side of the deployment is alive. The data proxies
// described in docs/data-sources.md live next to this file.
export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, service: 'flame', time: new Date().toISOString() });
}
