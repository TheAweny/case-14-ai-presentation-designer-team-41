import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { setupOpenApi } from './docs/openapi.js';
import { API_VERSION } from './health/health.controller.js';

const DEFAULT_PORT = 3001;

async function bootstrap(): Promise<void> {
  // No CORS: browsers talk to the web server, and the web server talks to the API.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  // An edited SlideIR includes text, tables, charts and image metadata, and a chat is saved whole
  // with slide previews on its result cards; both outgrow the default 100 KB JSON parser limit.
  app.useBodyParser('json', { limit: '5mb' });
  // The OpenAPI document as JSON; the web draws it at /api/docs.
  setupOpenApi(app, API_VERSION);
  const port = Number(process.env.API_PORT ?? DEFAULT_PORT);
  await app.listen(port, '0.0.0.0');
  Logger.log(`API listening on port ${port}`, 'Bootstrap');
}

void bootstrap();
