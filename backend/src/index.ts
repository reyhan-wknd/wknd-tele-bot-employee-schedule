import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import path from 'path';
import { launchBot } from './bot';
import { startScheduler } from './scheduler';
import { authRouter } from './routes/auth';
import { APP_TIME_ZONE } from './lib/time';

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/auth', authRouter);

// Serve frontend static files.
app.use(express.static(path.join(__dirname, '../../frontend')));

// Error handler global: balas ringkas, dan jangan pernah mengirim stack trace ke klien.
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  console.error(`Error pada ${req.method} ${req.path}:`, err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Internal server error' });
});

// Satu permintaan atau listener yang gagal tidak boleh mematikan seluruh layanan —
// termasuk job scheduler yang berjalan di proses yang sama.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection (proses tetap jalan):', reason);
});

// Exception yang tak tertangkap meninggalkan proses dalam keadaan tak menentu:
// catat, lalu keluar supaya supervisor menghidupkannya kembali.
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception, proses keluar agar direstart supervisor:', err);
  process.exit(1);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} (zona waktu aplikasi: ${APP_TIME_ZONE})`);
  void launchBot(app);
  startScheduler();
});
