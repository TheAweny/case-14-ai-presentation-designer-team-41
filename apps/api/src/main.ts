import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';

const DEFAULT_PORT = 3001;

async function bootstrap(): Promise<void> {
  // No CORS: browsers talk to the web server, and the web server talks to the API.
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // A chat is saved whole: its result cards carry slide previews, more than the default 100 KB.
  app.useBodyParser('json', { limit: '5mb' });
  const port = Number(process.env.API_PORT ?? DEFAULT_PORT);
  await app.listen(port, '0.0.0.0');
  Logger.log(`API listening on port ${port}`, 'Bootstrap');
}

void bootstrap();
