#!/usr/bin/env node
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const { startServer } = await import('../server.js');
await startServer();
