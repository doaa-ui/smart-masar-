import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { initDatabase } from './server/db.ts';
import { initOrgDatabase } from './server/orgDb.ts';
import { createApiRouter } from './server/routes.ts';

async function startServer() {
  initDatabase();
  initOrgDatabase();

  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'smart-masar' });
  });

  app.use('/api', createApiRouter());

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Smart Masar server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Smart Masar server:', err);
  process.exit(1);
});
