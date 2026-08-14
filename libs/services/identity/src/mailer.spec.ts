import { createServer, type AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createSmtpMailer } from './mailer.js';

describe('createSmtpMailer', () => {
  it('sends a reset message over SMTP', async () => {
    const received: string[] = [];
    const server = createServer((socket) => {
      socket.write('220 test\r\n');
      socket.on('data', (buf) => {
        const text = buf.toString();
        received.push(text);
        if (text.startsWith('DATA')) {
          socket.write('354 go\r\n');
        } else if (text.startsWith('QUIT')) {
          socket.write('221 bye\r\n');
          socket.end();
        } else {
          socket.write('250 ok\r\n');
        }
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    try {
      await createSmtpMailer(`smtp://127.0.0.1:${port}`)({
        to: 'a@b.c',
        subject: 'Reset',
        text: 'link',
      });
    } finally {
      server.close();
    }
    expect(received.join('')).toContain('RCPT TO:<a@b.c>');
    expect(received.join('')).toContain('link');
  });
});
