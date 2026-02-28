import Fastify, { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import path from 'path';
import fastifyStatic from '@fastify/static';
import * as os from 'os';

dotenv.config();

const fastify: FastifyInstance = Fastify({
    logger: false,
    disableRequestLogging: true
});

fastify.register(fastifyStatic, {
    root: path.join(__dirname, '../public'),
    prefix: '/', // serve at root
});

const prisma = new PrismaClient();

// --- Global State ---
let activeModelStr = "qwen2.5-coder:1.5b";
let pullProgressState: Record<string, { status: string, total: number, completed: number, percent: number }> = {};

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
        const tagsResponse = await fetch(`${ollamaUrl}/api/tags`);
        const tagsData = await tagsResponse.json();
        const models = tagsData.models || [];

        if (models.length === 0) {
            throw new Error("No Ollama models installed. The setup script should have installed 'qwen2.5-coder:1.5b'.");
        }

        let modelName = models[0].name;

        if (models.some((m: any) => m.name === activeModelStr)) {
            modelName = activeModelStr;
        } else {
            console.log(`[BACKEND] Active model '${activeModelStr}' not found in Ollama. Falling back to '${modelName}'.`);
        }

        console.log(`[BACKEND] Using model: ${modelName}`);

        const systemPrompt = `You are B-AILA, an advanced Blender Python AI Assistant.
The user wants to execute an action in Blender via Python script.

CRITICAL RULES FOR GEOMETRY CREATION:
1. DO NOT rely blindly on simple GUI operators (e.g., \`bpy.ops.mesh.primitive_cube_add\`) if the requested object is complex.
2. If the user asks for a complex object (like a "star", "staircase", "gear"), you MUST use procedural math to generate vertices/faces, and construct it using \`from_pydata\`.
3. Example of procedural generation:
\`\`\`python
import bpy, math
vertices = [(0,0,0), (1,0,0), (0,1,0)]
edges = []
faces = [(0, 1, 2)]
mesh = bpy.data.meshes.new("GeneratedMesh")
mesh.from_pydata(vertices, edges, faces)
mesh.update()
obj = bpy.data.objects.new("GeneratedObj", mesh)
bpy.context.collection.objects.link(obj)
\`\`\`

CRITICAL RULES FOR CONTEXT:
1. You will receive a 'Context' block containing the currently selected objects. DO NOT modify them UNLESS explicitly asked.
2. If asked for a NEW object, build it and IGNORE the context objects.

Respond with a friendly message explaining what you did, and provide the python code wrapped in markdown blocks like this:
\`\`\`python
# your code
\`\`\`
`;

        const response = await fetch(`${ollamaUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: modelName,
                system: systemPrompt,
                prompt: prompt + (context ? `\nContext: ${JSON.stringify(context)}` : ""),
                stream: false,
                options: {
                    num_predict: 4096,
                    temperature: 0.1
                }
            })
        });

        const data = await response.json();

        // Extract Python Code from Markdown Blocks
        const rawResponse = data.response || "";
        let pythonCode = "";
        const codeMatch = rawResponse.match(/\`\`\`python\n([\s\S]*?)\`\`\`/);

        if (codeMatch && codeMatch[1]) {
            pythonCode = codeMatch[1];
        } else {
            console.error("Failed to extract python block from markdown, attempting raw fallback.");
            pythonCode = rawResponse;
        }

        // Clean any residual tokens
        pythonCode = pythonCode
            .replace(/<\|.*?\|>/g, "\n")
            .replace(/<｜.*?｜>/g, "\n")
            .replace(/｜/g, "\n");

        await prisma.aIJob.update({
            where: { id: jobId },
            data: {
                status: 'completed',
                response: "Procedural geometry script generated.",
                pythonCode: pythonCode
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

// Dashboard API: Get Recent Jobs
fastify.get('/api/jobs', async (request: any, reply: any) => {
    const jobs = await prisma.aIJob.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10
    });
    return jobs;
});

// Dashboard API: Get Available Models
fastify.get('/api/models', async (request: any, reply: any) => {
    const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
    try {
        const response = await fetch(`${ollamaUrl}/api/tags`);
        const data = await response.json();

        let models = data.models || [];
        models = models.map((m: any) => ({
            name: m.name,
            size: (m.size / 1024 / 1024 / 1024).toFixed(1) + 'GB',
            isActive: m.name === activeModelStr
        }));

        return { status: 'ok', models };
    } catch (e) {
        return { status: 'error', error: "Could not connect to Ollama", models: [] };
    }
});

// Advanced Model Management Endpoints
fastify.get('/api/models/recommended', async (request: any, reply: any) => {
    return [
        // --- LIGHTWEIGHT ---
        { name: "qwen2.5-coder:1.5b", size: "936MB", tier: "lightweight", description: "Ultra-fast & lightweight. Great default for basic object creation.", tags: ["recommended", "fast"] },
        { name: "phi3.5:3.8b", size: "2.2GB", tier: "lightweight", description: "Microsoft Phi-3.5. Efficient and surprisingly capable for small scripts.", tags: ["fast"] },
        // --- MEDIUM ---
        { name: "qwen2.5-coder:7b", size: "4.7GB", tier: "medium", description: "Best balance of speed and quality. Excellent Python & BMesh generation.", tags: ["recommended", "pro"] },
        { name: "deepseek-coder:6.7b", size: "3.8GB", tier: "medium", description: "Strong alternative coder. Very good for logical & algorithmic tasks.", tags: ["pro"] },
        { name: "codellama:7b", size: "3.8GB", tier: "medium", description: "Meta CodeLlama. Reliable Python expert, good for structured code.", tags: ["pro"] },
        { name: "granite-code:8b", size: "4.6GB", tier: "medium", description: "IBM Granite. Optimized for code generation and structured patterns.", tags: ["pro"] },
        // --- ADVANCED ---
        { name: "qwen2.5-coder:14b", size: "9.0GB", tier: "advanced", description: "Qwen 14B. Near GPT-4 code quality. Excels at complex 3D geometry scripts.", tags: ["advanced", "pro"] },
        { name: "deepseek-coder:33b", size: "19GB", tier: "advanced", description: "DeepSeek 33B. Extremely capable at advanced procedural math and geometry.", tags: ["advanced", "pro"] },
    ];
});

fastify.post('/api/settings/model', async (request: any, reply: any) => {
    const { model } = request.body as { model: string };
    if (!model) return reply.status(400).send({ error: "Model name required" });

    activeModelStr = model;
    console.log(`[BACKEND] Active model set to: ${activeModelStr}`);
    return { success: true, activeModel: activeModelStr };
});

fastify.post('/api/models/pull', async (request: any, reply: any) => {
    const { model } = request.body as { model: string };
    const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';

    if (!model) return reply.status(400).send({ error: "Model name required" });

    // Initialize progress state
    pullProgressState[model] = { status: "starting", total: 0, completed: 0, percent: 0 };

    // Do not await the whole fetch, grab it and handle stream asynchronously
    fetch(`${ollamaUrl}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: model, stream: true })
    }).then(async (response) => {
        if (!response.body) {
            pullProgressState[model] = { status: "failed", total: 0, completed: 0, percent: 0 };
            return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                pullProgressState[model] = { status: "success", total: 100, completed: 100, percent: 100 };
                break;
            }

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\\n').filter(l => l.trim().length > 0);

            for (const line of lines) {
                try {
                    const parsed = JSON.parse(line);
                    if (parsed.total && parsed.completed) {
                        const pct = Math.round((parsed.completed / parsed.total) * 100);
                        pullProgressState[model] = {
                            status: parsed.status,
                            total: parsed.total,
                            completed: parsed.completed,
                            percent: pct
                        };
                    } else if (parsed.status === "success") {
                        pullProgressState[model] = { status: "success", total: 100, completed: 100, percent: 100 };
                    }
                } catch (e) {
                    // ignore chunk parse errors
                }
            }
        }
    }).catch(e => {
        console.error("Pull failed:", e);
        pullProgressState[model] = { status: "failed", total: 0, completed: 0, percent: 0 };
    });

    return { status: "pulling", model: model };
});

fastify.get('/api/models/pull/status', async (request: any, reply: any) => {
    const { model } = request.query as { model?: string };
    if (!model) {
        return pullProgressState;
    }
    return pullProgressState[model] || { status: "unknown", percent: 0 };
});

// Dashboard API: Get System Performance
fastify.get('/api/system', async (request: any, reply: any) => {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memoryUsagePercent = (usedMem / totalMem) * 100;

    const cpus = os.cpus();
    let user = 0, nice = 0, sys = 0, idle = 0, irq = 0;
    for (let cpu of cpus) {
        user += cpu.times.user;
        nice += cpu.times.nice;
        sys += cpu.times.sys;
        idle += cpu.times.idle;
        irq += cpu.times.irq;
    }
    const total = user + nice + sys + idle + irq;
    const active = user + nice + sys + irq;
    const cpuUsagePercent = (active / total) * 100;

    return {
        cpuUsage: cpuUsagePercent.toFixed(1),
        memoryUsage: memoryUsagePercent.toFixed(1)
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
