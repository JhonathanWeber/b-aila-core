import Fastify, { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import path from 'path';
import fastifyStatic from '@fastify/static';

dotenv.config();

const fastify: FastifyInstance = Fastify({
    logger: true
});

fastify.register(fastifyStatic, {
    root: path.join(__dirname, '../public'),
    prefix: '/', // serve at root
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
    console.log(`[BACKEND] Triggering generation for job ${job.id} on ${ollamaUrl}...`);

    // Async processing to not block the response
    processAIJob(job.id, prompt, context, ollamaUrl).catch(console.error);

    return { job_id: job.id, status: 'processing', target: ollamaUrl };
});

async function processAIJob(jobId: string, prompt: string, context: any, ollamaUrl: string) {
    try {
        console.log(`[BACKEND] Fetching available models from Ollama...`);
        // Get first available model
        const tagsResponse = await fetch(`${ollamaUrl}/api/tags`);
        const tagsData = await tagsResponse.json();
        const models = tagsData.models || [];

        if (models.length === 0) {
            throw new Error("No Ollama models installed. Open a terminal and run 'ollama run llama3.2' first.");
        }

        const modelName = models[0].name;
        console.log(`[BACKEND] Using model: ${modelName}`);

        const systemPrompt = `You are B-AILA, a Blender AI Assistant.
The user wants to execute an action in Blender via Python script.
Respond ONLY with a JSON object. No markdown tags around json.
Format:
{
  "chat_message": "Friendly explanation of what you did",
  "python_code": "import bpy\\n# your blender python code"
}
`;

        const response = await fetch(`${ollamaUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: modelName,
                system: systemPrompt,
                prompt: prompt + (context ? `\nContext: ${JSON.stringify(context)}` : ""),
                stream: false,
                format: 'json'
            })
        });

        const data = await response.json();
        let resultJson: any = {};

        try {
            resultJson = JSON.parse(data.response);
        } catch (e) {
            console.error("Failed to parse JSON from AI, attempting raw fallback.");
            resultJson = { chat_message: "Here is the raw response", python_code: data.response };
        }

        await prisma.aIJob.update({
            where: { id: jobId },
            data: {
                status: 'completed',
                response: resultJson.chat_message || "Finished.",
                pythonCode: resultJson.python_code || ""
            }
        });
        console.log(`[BACKEND] Job ${jobId} completed successfully.`);

    } catch (error) {
        console.error(`[BACKEND] Error in processAIJob:`, error);
        await prisma.aIJob.update({
            where: { id: jobId },
            data: {
                status: 'failed',
                error: String(error)
            }
        });
    }
}

// Job Status Polling
fastify.get('/ai/status/:id', async (request: any, reply: any) => {
    const { id } = request.params as { id: string };

    const job = await prisma.aIJob.findUnique({
        where: { id }
    });

    if (!job) {
        return reply.status(404).send({ error: 'Job not found' });
    }

    return {
        status: job.status,
        data: {
            chat_message: job.response,
            python_code: job.pythonCode
        }
    };
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
