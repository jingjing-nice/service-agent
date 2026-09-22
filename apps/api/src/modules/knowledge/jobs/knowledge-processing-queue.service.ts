import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import { PrismaService } from '../../../database/prisma.service.js';
import { KnowledgeChunkService } from '../documents/knowledge-chunk.service.js';
import { KnowledgeIndexingService } from '../indexing/knowledge-indexing.service.js';

type KnowledgeJob = { tenantId: string; documentId: string };
const QUEUE_NAME = 'knowledge-processing';

function redisConnection() {
  const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6380');
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    maxRetriesPerRequest: null,
  };
}

@Injectable()
export class KnowledgeProcessingQueueService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(KnowledgeProcessingQueueService.name);
  private readonly queue = new Queue<KnowledgeJob>(QUEUE_NAME, {
    connection: redisConnection(),
  });
  private worker?: Worker<KnowledgeJob>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly chunks: KnowledgeChunkService,
    private readonly indexing: KnowledgeIndexingService,
  ) {}

  onModuleInit() {
    this.worker = new Worker<KnowledgeJob>(
      QUEUE_NAME,
      (job) => this.process(job),
      { connection: redisConnection(), concurrency: 2 },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.error(
        `Knowledge job ${job?.id ?? 'unknown'} failed`,
        error.stack,
      );
    });
  }

  async enqueue(tenantId: string, documentId: string) {
    const job = await this.queue.add(
      'parse-and-index',
      { tenantId, documentId },
      {
        jobId: documentId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1_000 },
        removeOnComplete: { age: 86_400, count: 1_000 },
        removeOnFail: { age: 604_800, count: 5_000 },
      },
    );
    return { jobId: job.id, documentId };
  }

  async getStatus(documentId: string) {
    const job = await this.queue.getJob(documentId);
    if (!job) return null;
    return {
      jobId: job.id,
      state: await job.getState(),
      attemptsMade: job.attemptsMade,
      failureReason: job.failedReason || undefined,
    };
  }

  private async process(job: Job<KnowledgeJob>) {
    const { tenantId, documentId } = job.data;
    try {
      await this.prisma.knowledgeDocument.updateMany({
        where: {
          id: documentId,
          tenantId,
          status: { in: ['UPLOADED', 'FAILED'] },
        },
        data: { status: 'PARSING', errorCode: null },
      });
      await this.chunks.saveMarkdownChunks(tenantId, documentId);
      return await this.indexing.indexDocumentDraft(tenantId, documentId);
    } catch (error) {
      const document = await this.prisma.knowledgeDocument.findFirst({
        where: { id: documentId, tenantId },
        select: { status: true },
      });
      await this.prisma.knowledgeDocument.updateMany({
        where: { id: documentId, tenantId },
        data: {
          status: document?.status === 'CHUNKED' ? 'CHUNKED' : 'FAILED',
          errorCode:
            document?.status === 'CHUNKED'
              ? 'KNOWLEDGE_INDEXING_FAILED'
              : 'KNOWLEDGE_CHUNKING_FAILED',
        },
      });
      throw error;
    }
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue.close();
  }
}
