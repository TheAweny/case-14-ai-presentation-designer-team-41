import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

const DEFAULT_PORT = 3001;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000' });
  const port = Number(process.env.API_PORT ?? DEFAULT_PORT);
  await app.listen(port, '0.0.0.0');
  Logger.log(`API listening on port ${port}`, 'Bootstrap');
}

void bootstrap();
