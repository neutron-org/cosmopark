import net from 'node:net';
import { logger } from './logger';
let counter = -1;
let server: net.Server | null = null;

export const getMutexCounter = async (): Promise<number> => {
  if (counter !== -1) {
    return counter;
  }
  counter = 0;
  const startPort = 6666;
  const mutexLogger = logger.child({ module: 'mutex' });
  // eslint-disable-next-line no-constant-condition
  while (counter < 1000) {
    mutexLogger.debug(`checking port ${startPort + counter}`);
    const res = await new Promise((r) => {
      server = net
        .createServer()
        .listen(startPort + counter)
        .on('listening', () => r(true))
        .on('error', (e) => {
          mutexLogger.debug(e);
          mutexLogger.debug(`port ${startPort + counter} is busy`);
          counter++;
          r(false);
        });
    });
    if (res) {
      return counter;
    }
  }
  mutexLogger.error('No free ports');
  throw new Error('No free ports');
};

export const releaseMutex = async (): Promise<void> => {
  if (server) {
    await new Promise((r) => server?.close(r));
  }
};
