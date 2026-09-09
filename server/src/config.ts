import './env.js';

const parsePort = (value: string | undefined): number => {
  const port = Number(value ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return port;
};

export const config = Object.freeze({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parsePort(process.env.PORT),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173'
});
