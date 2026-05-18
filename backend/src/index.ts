import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { launchBot } from './bot';
import { authRouter } from './routes/auth';

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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  launchBot(app);
});
