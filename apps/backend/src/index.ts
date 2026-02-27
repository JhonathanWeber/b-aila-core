import Fastify, { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config();

const fastify: FastifyInstance = Fastify({
    logger: true
});

const prisma = new PrismaClient();

// --- Types ---
interface GenerateRequest {
    prompt: string;
    context?: any;
    sessionId?: string;
}

// --- Routes ---

// Health Check
fastify.get('/health', async (request: any, reply: any) => {
    return { status: 'ok', service: 'B-AILA Backend' };
});

// AI Generation Trigger (Handshake)
fastify.post('/ai/generate', async (request: any, reply: any) => {
    const { prompt, context, sessionId } = request.body as GenerateRequest;
    const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';

    // Create a new job in the database
    const job = await prisma.aIJob.create({
        data: {
            status: 'processing',
            prompt: prompt
        }
    });

    // Log the intended target
    console.log(`[BACKEND] Triggering generation on ${ollamaUrl}...`);
    
    // In a real scenario, this would trigger an async call to Ollama
    return { job_id: job.id, status: 'processing', target: ollamaUrl };
});

// Job Status Polling
fastify.get('/ai/status/:id', async (request: any, reply: any) => {
    const { id } = request.params as { id: string };

    const job = await prisma.aIJob.findUnique({
        where: { id }
    });

    if (!job) {
        return reply.status(404).send({ error: 'Job not found' });
    }

    return { status: job.status, data: job };
});

// History / Sessions
fastify.get('/sessions', async (request: any, reply: any) => {
    return await prisma.chatSession.findMany({
        include: { messages: true }
    });
});

// Error Reporting (Self-Healing)
fastify.post('/ai/report-error', async (request: any, reply: any) => {
    const { job_id, error, failed_code } = request.body as any;
    console.log(`[SELF-HEALING] Error in job ${job_id}: ${error}`);
    // Here we would trigger a re-generation logic
    return { status: 'error_logged' };
});

// Start Server
const start = async () => {
    try {
        const port = parseInt(process.env.PORT || '8990');
        await fastify.listen({ port: port, host: '0.0.0.0' });
        console.log(`B-AILA Backend running at http://localhost:${port}`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
