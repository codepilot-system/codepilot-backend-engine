import dns from 'node:dns';
import app from './app';
import { ENV } from './config/env.config';
import './jobs/session-cleanup.job';

dns.setDefaultResultOrder('ipv4first');

app.listen(ENV.PORT, () => {
  console.log(`CodePilot Backend Engine started on http://localhost:${ENV.PORT}`);
});
