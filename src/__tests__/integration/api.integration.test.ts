import request from 'supertest';
import express from 'express';
import {
    setupTestDatabase,
    seedTestDatabase,
    teardownTestDatabase,
    verifyDatabaseConnection,
} from './test-db.setup';
import { generateTokens, createSession } from '../../services/auth/auth.service';
import { githubApp } from '../../services/github/github.service';

describe('API Integration Tests', () => {
    let app: express.Application;
    let authToken: string;
    let refreshToken: string;
    let testProjectId: number;
    let testScanId: number;
    let testIssueId: number;
    let testSuggestionId: number;
    let dbAvailable = false;

    function authGet(path: string) {
        return request(app).get(path).set('Authorization', `Bearer ${authToken}`);
    }

    function authPost(path: string) {
        return request(app).post(path).set('Authorization', `Bearer ${authToken}`);
    }

    function authPatch(path: string) {
        return request(app).patch(path).set('Authorization', `Bearer ${authToken}`);
    }

    beforeAll(async () => {
        dbAvailable = await verifyDatabaseConnection();
        if (!dbAvailable) {
            console.warn('Integration tests skipped: database unavailable');
            return;
        }

        await setupTestDatabase();
        const seeded = await seedTestDatabase('api');
        testProjectId = seeded.project.id;
        testScanId = seeded.scan.id;
        testIssueId = seeded.issue.id;
        testSuggestionId = seeded.suggestion.id;

        const tokens = await generateTokens(seeded.user.id);
        authToken = tokens.accessToken;
        refreshToken = tokens.refreshToken;
        await createSession(seeded.user.id, refreshToken);

        const { default: appModule } = await import('../../app');
        app = appModule;
    });

    afterAll(async () => {
        if (dbAvailable) {
            await teardownTestDatabase();
        }
    });

    describe('Health Endpoint', () => {
        it('should return health status', async () => {
            if (!dbAvailable) return;
            const response = await request(app).get('/api/health');
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('status', 'success');
        });
    });

    describe('Authentication Flow', () => {
        it('should get GitHub auth URL', async () => {
            if (!dbAvailable) return;
            const response = await request(app).get('/api/auth/github-url');
            expect(response.status).toBe(200);
            expect(response.body.data).toHaveProperty('url');
            expect(response.body.data.url).toContain('github.com');
        });

        it('should reject requests without authentication', async () => {
            if (!dbAvailable) return;
            const response = await request(app).get('/api/users/me');
            expect(response.status).toBe(401);
        });

        it('should accept requests with valid token', async () => {
            if (!dbAvailable) return;
            const response = await authGet('/api/users/me');
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('data');
        });

        it('should refresh tokens with valid refresh token', async () => {
            if (!dbAvailable) return;
            const response = await request(app)
                .post('/api/auth/extension/refresh')
                .send({ refreshToken });
            expect(response.status).toBe(200);
            expect(response.body.data).toHaveProperty('accessToken');
        });
    });

    describe('User Endpoints', () => {
        it('should get current user profile', async () => {
            if (!dbAvailable) return;
            const response = await authGet('/api/users/me');
            expect(response.status).toBe(200);
            expect(response.body.data).toHaveProperty('username');
            expect(response.body.data.username).toMatch(/^testuser_/);
        });
    });

    describe('Project Endpoints', () => {
        it('should get user projects', async () => {
            if (!dbAvailable) return;
            const response = await authGet('/api/projects');
            expect(response.status).toBe(200);
            expect(Array.isArray(response.body.data)).toBe(true);
            expect(response.body.data.length).toBeGreaterThan(0);
        });

        it('should get specific project', async () => {
            if (!dbAvailable) return;
            const response = await authGet(`/api/projects/${testProjectId}`);
            expect(response.status).toBe(200);
            expect(response.body.data).toHaveProperty('id', testProjectId);
        });

        it('should get project members', async () => {
            if (!dbAvailable) return;
            const response = await authGet(`/api/projects/${testProjectId}/members`);
            expect(response.status).toBe(200);
            expect(Array.isArray(response.body.data)).toBe(true);
        });

        it('should update project', async () => {
            if (!dbAvailable) return;
            const response = await authPatch(`/api/projects/${testProjectId}`)
                .send({ name: 'Updated Project Name' });
            expect(response.status).toBe(200);
        });
    });

    describe('Scan Endpoints', () => {
        it('should get project scans', async () => {
            if (!dbAvailable) return;
            const response = await authGet(`/api/scans?projectId=${testProjectId}`);
            expect(response.status).toBe(200);
            expect(Array.isArray(response.body.data)).toBe(true);
        });

        it('should get specific scan', async () => {
            if (!dbAvailable) return;
            const response = await authGet(`/api/scans/${testScanId}`);
            expect(response.status).toBe(200);
            expect(response.body.data).toHaveProperty('id', testScanId);
        });

        it('should get scan report PDF', async () => {
            if (!dbAvailable) return;
            const response = await authGet(`/api/scans/${testScanId}/report`);
            expect(response.status).toBe(200);
            expect(response.headers['content-type']).toContain('application/pdf');
        });

        it('should reject local analysis with invalid payload', async () => {
            if (!dbAvailable) return;
            const response = await authPost('/api/scans/local-analysis')
                .send({ invalid: 'data' });
            expect(response.status).toBe(400);
        });
    });

    describe('Issue Endpoints', () => {
        it('should get issues with filters', async () => {
            if (!dbAvailable) return;
            const response = await authGet(`/api/issues?projectId=${testProjectId}`);
            expect(response.status).toBe(200);
            expect(Array.isArray(response.body.data)).toBe(true);
        });

        it('should get specific issue', async () => {
            if (!dbAvailable) return;
            const response = await authGet(`/api/issues/${testIssueId}`);
            expect(response.status).toBe(200);
            expect(response.body.data).toHaveProperty('id', testIssueId);
        });

        it('should update issue status', async () => {
            if (!dbAvailable) return;
            const response = await authPatch(`/api/issues/${testIssueId}`)
                .send({ status: 'FIXED' });
            expect(response.status).toBe(200);
            expect(response.body.data.status).toBe('FIXED');
        });
    });

    describe('Suggestion Endpoints', () => {
        it('should get suggestions', async () => {
            if (!dbAvailable) return;
            const response = await authGet(`/api/suggestions?projectId=${testProjectId}`);
            expect(response.status).toBe(200);
            expect(Array.isArray(response.body.data)).toBe(true);
        });

        it('should get specific suggestion', async () => {
            if (!dbAvailable) return;
            const response = await authGet(`/api/suggestions/${testSuggestionId}`);
            expect(response.status).toBe(200);
            expect(response.body.data).toHaveProperty('id', testSuggestionId);
        });

        it('should list suggestion applies', async () => {
            if (!dbAvailable) return;
            const response = await authGet(`/api/suggestions/applies/list?projectId=${testProjectId}`);
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('data');
        });

        it('should bulk dismiss suggestions', async () => {
            if (!dbAvailable) return;
            const response = await authPost('/api/suggestions/bulk-dismiss')
                .send({ suggestionIds: [testSuggestionId] });
            expect([200, 404]).toContain(response.status);
        });
    });

    describe('Analytics Endpoint', () => {
        it('should get analytics', async () => {
            if (!dbAvailable) return;
            const response = await authGet(`/api/analytics?projectId=${testProjectId}`);
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('data');
        });
    });

    describe('AI Status Endpoint', () => {
        it('should get AI model statuses', async () => {
            if (!dbAvailable) return;
            const response = await authGet('/api/ai/statuses?scanType=local');
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('data');
        });
    });

    describe('GitHub Webhook', () => {
        describe('GitHub Webhook', () => {
            it('should reject an invalid webhook signature', async () => {
                if (!dbAvailable) return;

                jest.spyOn(githubApp.webhooks, 'verifyAndReceive')
                    .mockRejectedValueOnce(new Error('Invalid signature'));

                const response = await request(app)
                    .post('/api/webhooks/github')
                    .set('Content-Type', 'application/json')
                    .set('X-GitHub-Delivery', 'test-delivery')
                    .set('X-GitHub-Event', 'push')
                    .set('X-Hub-Signature-256', 'sha256=invalid')
                    .send(JSON.stringify({ action: 'push' }));

                expect(response.status).toBe(400);
                expect(response.body).toEqual({
                    error: 'Webhook verification failed',
                });
            });
        });
    });


    describe('Error Handling', () => {
        it('should return 401 for unauthenticated protected routes', async () => {
            if (!dbAvailable) return;
            const response = await request(app).get('/api/nonexistent');
            expect(response.status).toBe(401);
        });

        it('should return 401 for unauthorized access', async () => {
            if (!dbAvailable) return;
            const response = await request(app).get('/api/projects');
            expect(response.status).toBe(401);
        });
    });

    describe('Logout', () => {
        it('should logout and invalidate refresh token', async () => {
            if (!dbAvailable) return;
            const response = await request(app)
                .post('/api/auth/extension/logout')
                .send({ refreshToken });
            expect(response.status).toBe(200);
        });
    });
});
