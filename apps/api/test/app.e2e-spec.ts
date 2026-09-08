import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

describe('API health', () => {
  let app: INestApplication;
  beforeEach(async () => { const module = await Test.createTestingModule({ imports: [AppModule] }).compile(); app = module.createNestApplication(); await app.init(); });
  afterEach(async () => app.close());
  it('GET /api/health', () => request(app.getHttpServer()).get('/api/health').expect(200).expect({ status: 'ok', service: 'service-agent-api' }));
});
