import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

describe('AppController', () => {
  it('reports API health', () => {
    expect(new AppController(new AppService()).getHealth()).toEqual({ status: 'ok', service: 'service-agent-api' });
  });
});
