import dotenv from 'dotenv';
import path from 'path';


dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });

(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function() {
    return this.toString();
};

jest.mock('@octokit/request-error', () => ({
    RequestError: class RequestError extends Error {
        status: number;
        constructor(message: string, status = 500) {
            super(message);
            this.status = status;
        }
    },
}));

jest.mock('octokit', () => ({
    App: jest.fn().mockImplementation(() => ({
        getInstallationOctokit: jest.fn().mockResolvedValue({
            request: jest.fn(),
            rest: {
                repos: { get: jest.fn(), listForAuthenticatedUser: jest.fn() },
                pulls: { create: jest.fn(), list: jest.fn(), get: jest.fn(), update: jest.fn() },
                git: {
                    createRef: jest.fn(),
                    deleteRef: jest.fn(),
                    getRef: jest.fn(),
                    createTree: jest.fn(),
                    createCommit: jest.fn(),
                },
            },
        }),
        octokit: { auth: jest.fn().mockResolvedValue({ token: 'test-token' }) },
        webhooks: { on: jest.fn(), verifyAndReceive: jest.fn() },
    })),
    Octokit: jest.fn().mockImplementation(() => ({
        request: jest.fn(),
        rest: {
            repos: { get: jest.fn(), listForAuthenticatedUser: jest.fn() },
            pulls: { create: jest.fn(), list: jest.fn(), get: jest.fn(), update: jest.fn() },
            git: {
                createRef: jest.fn(),
                deleteRef: jest.fn(),
                getRef: jest.fn(),
                createTree: jest.fn(),
                createCommit: jest.fn(),
            },
        },
    })),
}));

jest.mock('groq-sdk', () => ({
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
        chat: {
            completions: {
                create: jest.fn().mockResolvedValue({
                    choices: [{ message: { content: JSON.stringify({ issues: [] }) } }],
                    usage: { total_tokens: 0 },
                }),
            },
        },
    })),
}));

jest.mock('redis', () => ({
    createClient: jest.fn(() => ({
        on: jest.fn(),
        connect: jest.fn().mockImplementation(async () => undefined),
        mGet: jest.fn().mockImplementation(async () => [null, null]),
        multi: jest.fn(() => ({
            incr: jest.fn().mockReturnThis(),
            expire: jest.fn().mockReturnThis(),
            incrBy: jest.fn().mockReturnThis(),
            exec: jest.fn().mockImplementation(async () => []),
        })),
        get: jest.fn().mockImplementation(async () => null),
        set: jest.fn().mockImplementation(async () => 'OK'),
        del: jest.fn().mockImplementation(async () => 1),
    })),
}));

jest.mock('p-limit', () => {
    return jest.fn().mockImplementation(() => jest.fn().mockImplementation((fn: () => unknown) => fn()));
});
