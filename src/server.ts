import dns from 'node:dns';
import http from 'http';
import { Server } from 'socket.io';

import app from './app';
import { ENV } from './config/env.config';

import './jobs/session-cleanup.job';
import './jobs/suggestion-apply-cleanup.job';

dns.setDefaultResultOrder('ipv4first');

const server = http.createServer(app);

export const io = new Server(server, {
    cors: {
        origin: ENV.FRONTEND_URL,
        methods: ['GET', 'POST'],
    },
});

server.listen(ENV.PORT, () => {
    console.log(
        `CodePilot Backend Engine started on http://localhost:${ENV.PORT}`
    );
});
