import app from './app';
import { ENV } from './config/env.config';

app.listen(ENV.PORT, () => {
  console.log(`CodePilot Backend Engine started on http://localhost:${ENV.PORT}`);
});
