import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';

const DEFAULT_PORT = 3001;

async function bootstrap(): Promise<void> {
  // No CORS: browsers talk to the web server, and the web server talks to the API.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  // An edited SlideIR includes text, tables, charts and image metadata; the default 100 KB
  // parser limit rejects normal multi-slide decks before the controller can export them.
  app.useBodyParser('json', { limit: '2mb' });
  const port = Number(process.env.API_PORT ?? DEFAULT_PORT);
  await app.listen(port, '0.0.0.0');
  Logger.log(`API listening on port ${port}`, 'Bootstrap');
}

void bootstrap();
